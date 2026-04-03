import {describe, it, expect} from 'vitest';
import {isAutoWorkEnabled} from '../src/auto-work.js';
import type {DevPulseConfig, Issue} from '../src/types.js';
import {LABELS} from '../src/types.js';

function makeConfig(overrides: Partial<DevPulseConfig> = {}): DevPulseConfig {
	return {
		agentCmd: 'pi',
		provider: 'anthropic',
		model: 'test-model',
		maxIterations: 1,
		workDir: '/tmp',
		noPush: false,
		noSleep: true,
		dryRun: false,
		autoWork: false,
		...overrides,
	};
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
	return {
		number: 1,
		title: 'Test issue',
		body: 'Some issue body',
		labels: [],
		url: 'https://github.com/test/test/issues/1',
		...overrides,
	};
}

describe('isAutoWorkEnabled', () => {
	it('returns false when no conditions are met', () => {
		expect(isAutoWorkEnabled(makeConfig(), makeIssue())).toBe(false);
	});

	it('returns true when config.autoWork is true', () => {
		expect(isAutoWorkEnabled(makeConfig({autoWork: true}), makeIssue())).toBe(true);
	});

	it('returns true when issue has the auto-work label', () => {
		const issue = makeIssue({labels: [LABELS.AUTO_WORK]});
		expect(isAutoWorkEnabled(makeConfig(), issue)).toBe(true);
	});

	it('returns true when issue body contains whitesmith:auto-work', () => {
		const issue = makeIssue({body: 'Please enable whitesmith:auto-work for this issue'});
		expect(isAutoWorkEnabled(makeConfig(), issue)).toBe(true);
	});

	it('returns true when multiple conditions are met', () => {
		const config = makeConfig({autoWork: true});
		const issue = makeIssue({
			labels: [LABELS.AUTO_WORK],
			body: 'whitesmith:auto-work',
		});
		expect(isAutoWorkEnabled(config, issue)).toBe(true);
	});

	it('does not match partial label strings', () => {
		const issue = makeIssue({labels: ['whitesmith:auto-work-extra']});
		expect(isAutoWorkEnabled(makeConfig(), issue)).toBe(false);
	});
});
