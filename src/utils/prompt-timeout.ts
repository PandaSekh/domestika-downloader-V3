import type { Question } from 'inquirer';

/**
 * Wrapper for inquirer.prompt with timeout support
 * Returns default value if timeout is reached
 */
export async function promptWithTimeout<T extends Record<string, unknown>>(
	promptPromise: Promise<T>,
	timeoutMs: number,
	defaultValue: T,
	timeoutMessage: string
): Promise<T> {
	const timeoutPromise = new Promise<T>((resolve) => {
		setTimeout(() => {
			console.log(`\n⏱️  ${timeoutMessage}`);
			resolve(defaultValue);
		}, timeoutMs);
	});

	return Promise.race([promptPromise, timeoutPromise]);
}

