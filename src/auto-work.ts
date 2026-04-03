import type {DevPulseConfig, Issue} from './types.js';
import {LABELS} from './types.js';

/**
 * Check whether auto-work mode is enabled for a given issue.
 *
 * Returns true if any of these conditions are met:
 * 1. `config.autoWork` is `true` (global config / CLI flag)
 * 2. The issue has the `whitesmith:auto-work` label
 * 3. The issue body contains the string `whitesmith:auto-work`
 */
export function isAutoWorkEnabled(config: DevPulseConfig, issue: Issue): boolean {
	if (config.autoWork) {
		return true;
	}

	if (issue.labels.includes(LABELS.AUTO_WORK)) {
		return true;
	}

	if (issue.body.includes('whitesmith:auto-work')) {
		return true;
	}

	return false;
}
