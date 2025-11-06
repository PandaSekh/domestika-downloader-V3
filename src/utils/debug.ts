/**
 * Debug logging utility
 * Only logs when DEBUG=true in .env file
 */

import type * as cliProgress from 'cli-progress';

const isDebugMode = process.env.DEBUG === 'true';

// Store active multiBar for logging
let activeMultiBar: cliProgress.MultiBar | null = null;

/**
 * Set the active MultiBar instance for logging
 */
export function setActiveMultiBar(multiBar: cliProgress.MultiBar | null): void {
	activeMultiBar = multiBar;
}

/**
 * Get the active MultiBar instance
 */
export function getActiveMultiBar(): cliProgress.MultiBar | null {
	return activeMultiBar;
}

/**
 * Log that works with progress bars
 * Uses multiBar.log() if progress bars are active, otherwise console.log()
 */
export function log(message: string, multiBar?: cliProgress.MultiBar | null): void {
	const bar = multiBar ?? activeMultiBar;
	if (bar) {
		bar.log(`${message}\n`);
	} else {
		console.log(message);
	}
}

/**
 * Error log that works with progress bars
 */
export function logError(message: string, multiBar?: cliProgress.MultiBar | null): void {
	const bar = multiBar ?? activeMultiBar;
	if (bar) {
		bar.log(`${message}\n`);
	} else {
		console.error(message);
	}
}

/**
 * Log a debug message (only if DEBUG=true)
 * Uses safe logging if progress bars are active
 */
export function debugLog(...args: unknown[]): void {
	if (isDebugMode) {
		const message = args
			.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
			.join(' ');
		log(message);
	}
}

/**
 * Check if debug mode is enabled
 */
export function isDebug(): boolean {
	return isDebugMode;
}
