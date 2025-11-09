import { spawn } from 'node:child_process';
import type * as cliProgress from 'cli-progress';

// Function to execute yt-dlp and let it display its native progress
export function executeWithProgress(
	command: string,
	args: string[],
	_videoTitle: string,
	_multiBar?: cliProgress.MultiBar
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const childProcess = spawn(command, args, {
			cwd: process.cwd(),
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'], // stdin: ignore, stdout/stderr: pipe
		});

		// Limit buffer sizes to prevent memory leaks (max 100KB each)
		const MAX_BUFFER_SIZE = 100 * 1024;
		let stdout = '';
		let stderr = '';

		// Pipe stdout to console and capture it
		if (childProcess.stdout) {
			childProcess.stdout.on('data', (data: Buffer) => {
				const dataStr = data.toString();
				// Write directly to console so yt-dlp's progress shows
				process.stdout.write(data);
				// Also capture for error messages
				stdout += dataStr;
				if (stdout.length > MAX_BUFFER_SIZE) {
					stdout = stdout.slice(-MAX_BUFFER_SIZE);
				}
			});
		}

		// Pipe stderr to console and capture it
		if (childProcess.stderr) {
			childProcess.stderr.on('data', (data: Buffer) => {
				const dataStr = data.toString();
				// Write directly to console so yt-dlp's progress shows
				process.stderr.write(data);
				// Also capture for error messages
				stderr += dataStr;
				if (stderr.length > MAX_BUFFER_SIZE) {
					stderr = stderr.slice(-MAX_BUFFER_SIZE);
				}
			});
		}

		childProcess.on('close', (code: number | null) => {
			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				reject(new Error(`Process exited with code ${code}. ${stderr || stdout}`));
			}
		});

		childProcess.on('error', (error: Error) => {
			reject(error);
		});
	});
}
