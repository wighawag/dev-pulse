#!/bin/bash
# mock-agent.sh - Mock coding agent for testing markplane-ralph-epic
#
# This simulates an AI coding agent that:
# - In DISCOVERY mode: Only reports epic info (no work, no commits)
# - In WORK mode: Creates files, commits changes
# - Signals epic/project completion appropriately
#
# Usage: mock-agent.sh "<prompt>"
#
# The mock maintains state in .mock-agent-state to track progress across iterations.

PROMPT="$1"
WORK_DIR=$(pwd)
MOCK_STATE_FILE="$WORK_DIR/.mock-agent-state"

# Initialize variables
TASK_COUNTER=0
CURRENT_EPIC=""

# Epic definitions (simulates what markplane would provide)
# Format: EPIC_NAME|DEPENDS_ON|TASKS_TOTAL
declare -A EPICS
EPICS["EPIC-001"]="User Authentication||2"
EPICS["EPIC-002"]="Dashboard UI|EPIC-001|2"
EPICS["EPIC-003"]="API Integration|EPIC-002|1"

# Ordered list of epics for iteration
EPIC_ORDER=("EPIC-001" "EPIC-002" "EPIC-003")

# Track completed tasks per epic (declare early)
declare -A COMPLETED_TASKS

# Load completed tasks from state file if it exists
if [ -f "$MOCK_STATE_FILE" ]; then
    while IFS='=' read -r key value; do
        # Only process COMPLETED_ lines, skip others
        if [[ $key =~ ^COMPLETED_ ]]; then
            epic_key="${key#COMPLETED_}"
            # Remove any trailing characters
            value="${value%%[^0-9]*}"
            [ -n "$value" ] && COMPLETED_TASKS["$epic_key"]="$value"
        fi
    done < "$MOCK_STATE_FILE"
fi

# Function to check if an epic is complete
is_epic_complete() {
    local epic_id="$1"
    local tasks_done="${COMPLETED_TASKS[$epic_id]:-0}"
    IFS='|' read -r _ _ tasks_total <<< "${EPICS[$epic_id]}"
    [ "$tasks_done" -ge "$tasks_total" ]
}

# Function to find the next incomplete epic
find_next_epic() {
    for epic_id in "${EPIC_ORDER[@]}"; do
        IFS='|' read -r epic_name depends_on tasks_total <<< "${EPICS[$epic_id]}"
        
        # Check if epic is already complete
        local tasks_done="${COMPLETED_TASKS[$epic_id]:-0}"
        if [ "$tasks_done" -ge "$tasks_total" ]; then
            continue
        fi
        
        # Check if dependency is satisfied
        if [ -n "$depends_on" ]; then
            local dep_done="${COMPLETED_TASKS[$depends_on]:-0}"
            IFS='|' read -r _ _ dep_total <<< "${EPICS[$depends_on]}"
            if [ "$dep_done" -lt "$dep_total" ]; then
                continue
            fi
        fi
        
        # Found an incomplete epic with satisfied dependencies
        echo "$epic_id"
        return 0
    done
    
    # All epics complete
    echo "DONE"
    return 0
}

# Detect which mode we're in based on the prompt
IS_DISCOVERY_MODE=false
if echo "$PROMPT" | grep -q "ONLY task right now is to identify"; then
    IS_DISCOVERY_MODE=true
fi
if echo "$PROMPT" | grep -q "discovery phase"; then
    IS_DISCOVERY_MODE=true
fi

# =======================
# DISCOVERY MODE
# =======================
if [ "$IS_DISCOVERY_MODE" = true ]; then
    echo "=== Mock Agent: DISCOVERY MODE ==="
    echo ""
    
    # Check for epics to skip (branches already exist)
    # Parse the prompt for "IMPORTANT: The following epic IDs already have branches"
    SKIP_EPICS=""
    if echo "$PROMPT" | grep -q "already have branches"; then
        # Extract epic IDs from the prompt (format: "  - EPIC-XXX")
        SKIP_EPICS=$(echo "$PROMPT" | grep -E "^\s*-\s*EPIC-" | sed 's/.*-\s*\(EPIC-[0-9]*\).*/\1/')
        if [ -n "$SKIP_EPICS" ]; then
            echo "Epics to skip (have branches): $(echo $SKIP_EPICS | tr '\n' ' ')"
        fi
    fi
    
    # Find next epic, respecting skip list
    NEXT_EPIC=""
    for epic_id in "${EPIC_ORDER[@]}"; do
        # Check if this epic should be skipped
        if echo "$SKIP_EPICS" | grep -q "^$epic_id$"; then
            echo "Skipping $epic_id (has existing branch)"
            continue
        fi
        
        IFS='|' read -r epic_name depends_on tasks_total <<< "${EPICS[$epic_id]}"
        
        # Check if epic is already complete (from our internal state)
        tasks_done="${COMPLETED_TASKS[$epic_id]:-0}"
        if [ "$tasks_done" -ge "$tasks_total" ]; then
            continue
        fi
        
        # Check if dependency is satisfied (either complete or in skip list = has branch)
        if [ -n "$depends_on" ]; then
            dep_done="${COMPLETED_TASKS[$depends_on]:-0}"
            IFS='|' read -r _ _ dep_total <<< "${EPICS[$depends_on]}"
            # Dependency satisfied if: complete OR has existing branch
            if [ "$dep_done" -lt "$dep_total" ] && ! echo "$SKIP_EPICS" | grep -q "^$depends_on$"; then
                continue
            fi
        fi
        
        # Found an incomplete epic with satisfied dependencies
        NEXT_EPIC="$epic_id"
        break
    done
    
    if [ -z "$NEXT_EPIC" ]; then
        echo "All epics are complete!"
        echo ""
        echo "RALPH_COMPLETE"
        exit 0
    fi
    
    # Output only the required epic info
    IFS='|' read -r epic_name depends_on tasks_total <<< "${EPICS[$NEXT_EPIC]}"
    
    echo "EPIC_ID: $NEXT_EPIC"
    echo "EPIC_NAME: $epic_name"
    echo "DEPENDS_ON: $depends_on"
    echo ""
    echo "--- Mock agent discovery complete ---"
    exit 0
fi

# =======================
# WORK MODE
# =======================
echo "=== Mock Agent: WORK MODE ==="
echo ""

# Extract current epic from the prompt (the script tells us which epic we're on)
CURRENT_EPIC=$(echo "$PROMPT" | grep -o 'EPIC-[0-9]\+' | head -1)

if [ -z "$CURRENT_EPIC" ]; then
    echo "ERROR: Could not determine current epic from prompt"
    exit 1
fi

# Parse current epic info
IFS='|' read -r EPIC_NAME DEPENDS_ON TASKS_TOTAL <<< "${EPICS[$CURRENT_EPIC]}"

# Load completed task count for this epic
TASK_COUNTER="${COMPLETED_TASKS[$CURRENT_EPIC]:-0}"
TASK_COUNTER=$((TASK_COUNTER + 1))

echo "Working on: $CURRENT_EPIC ($EPIC_NAME)"
echo "Task $TASK_COUNTER of $TASKS_TOTAL"
echo ""

# Simulate file creation (the actual "work")
TASK_FILE="$WORK_DIR/src/${CURRENT_EPIC,,}/task-${TASK_COUNTER}.ts"
mkdir -p "$(dirname "$TASK_FILE")"

cat > "$TASK_FILE" << EOF
// $EPIC_NAME - Task $TASK_COUNTER
// Epic: $CURRENT_EPIC
// Generated by mock-agent

export function task${TASK_COUNTER}() {
    console.log('Task $TASK_COUNTER for $EPIC_NAME implemented!');
    return { success: true, epic: '$CURRENT_EPIC', task: $TASK_COUNTER };
}
EOF

echo "📝 Created: $TASK_FILE"
echo ""

# Commit changes (work mode always commits)
echo "💾 Committing changes..."
git add .
git commit -m "feat($CURRENT_EPIC): implement task $TASK_COUNTER for $EPIC_NAME"
echo ""

# Update state - track completed tasks per epic
COMPLETED_TASKS[$CURRENT_EPIC]=$TASK_COUNTER

# Save state
{
    for epic_id in "${!COMPLETED_TASKS[@]}"; do
        echo "COMPLETED_$epic_id=${COMPLETED_TASKS[$epic_id]}"
    done
} > "$MOCK_STATE_FILE"

# Check if this epic is complete
if [ $TASK_COUNTER -ge $TASKS_TOTAL ]; then
    echo "✅ All tasks in $EPIC_NAME completed!"
    echo ""
    echo "EPIC_COMPLETE"
    echo ""
    echo "PR_DESCRIPTION_START"
    echo "## $EPIC_NAME"
    echo ""
    echo "### Summary"
    echo "Implemented all $TASKS_TOTAL tasks for the $EPIC_NAME epic."
    echo ""
    echo "### Changes"
    for i in $(seq 1 $TASKS_TOTAL); do
        echo "- Task $i: Added implementation in \`src/${CURRENT_EPIC,,}/task-${i}.ts\`"
    done
    echo ""
    echo "### Testing"
    echo "All acceptance criteria have been verified."
    echo "PR_DESCRIPTION_END"
    
    # Check if ALL epics are done
    ALL_DONE=true
    for epic_id in "${EPIC_ORDER[@]}"; do
        IFS='|' read -r _ _ total <<< "${EPICS[$epic_id]}"
        done_count="${COMPLETED_TASKS[$epic_id]:-0}"
        if [ "$done_count" -lt "$total" ]; then
            ALL_DONE=false
            break
        fi
    done
    
    if [ "$ALL_DONE" = true ]; then
        echo ""
        echo "🎉 All epics completed!"
        echo "RALPH_COMPLETE"
    fi
fi

echo ""
echo "--- Mock agent work iteration complete ---"
