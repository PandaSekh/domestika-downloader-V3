/**
 * Debug logging utility
 * Only logs when DEBUG=true in .env file
 */

import type * as cliProgress from 'cli-progress';

const isDebugMode = process.env.DEBUG === 'true';

// ANSI color codes
const colors = {
	reset: '\x1b[0m',
	green: '\x1b[32m',
	white: '\x1b[37m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
	cyan: '\x1b[36m',
};

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
	const coloredMessage = `${colors.white}${message}${colors.reset}`;
	if (bar) {
		bar.log(`${coloredMessage}\n`);
	} else {
		console.log(coloredMessage);
	}
}

/**
 * Success log (green)
 */
export function logSuccess(message: string, multiBar?: cliProgress.MultiBar | null): void {
	const bar = multiBar ?? activeMultiBar;
	const coloredMessage = `${colors.green}${message}${colors.reset}`;
	if (bar) {
		bar.log(`${coloredMessage}\n`);
	} else {
		console.log(coloredMessage);
	}
}

/**
 * Error log that works with progress bars (red)
 */
export function logError(message: string, multiBar?: cliProgress.MultiBar | null): void {
	const bar = multiBar ?? activeMultiBar;
	const coloredMessage = `${colors.red}${message}${colors.reset}`;
	if (bar) {
		bar.log(`${coloredMessage}\n`);
	} else {
		console.error(coloredMessage);
	}
}

/**
 * Warning log (yellow)
 */
export function logWarning(message: string, multiBar?: cliProgress.MultiBar | null): void {
	const bar = multiBar ?? activeMultiBar;
	const coloredMessage = `${colors.yellow}${message}${colors.reset}`;
	if (bar) {
		bar.log(`${coloredMessage}\n`);
	} else {
		console.log(coloredMessage);
	}
}

/**
 * Log a debug message (only if DEBUG=true) - cyan color
 * Uses safe logging if progress bars are active
 */
export function logDebug(...args: unknown[]): void {
	if (isDebugMode) {
		const message = args
			.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
			.join(' ');
		const coloredMessage = `${colors.cyan}${message}${colors.reset}`;
		const bar = activeMultiBar;
		if (bar) {
			bar.log(`${coloredMessage}\n`);
		} else {
			console.log(coloredMessage);
		}
	}
}

/**
 * Check if debug mode is enabled
 */
export function isDebug(): boolean {
	return isDebugMode;
}
