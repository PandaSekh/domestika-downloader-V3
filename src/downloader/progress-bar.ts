import { spawn } from 'node:child_process';
import * as cliProgress from 'cli-progress';

// Function to execute N_m3u8DL-RE with progress tracking
export function executeWithProgress(
	command: string,
	args: string[],
	videoTitle: string,
	multiBar?: cliProgress.MultiBar
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		// Truncate video title if too long for display
		const displayTitle = videoTitle.length > 30 ? `${videoTitle.substring(0, 27)}...` : videoTitle;

		// Format helper functions
		const formatBytes = (bytes: number): string => {
			if (bytes === 0) return '0 B';
			const k = 1024;
			const sizes = ['B', 'KB', 'MB', 'GB'];
			const i = Math.floor(Math.log(bytes) / Math.log(k));
			return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
		};

		const formatSpeed = (bytesPerSecond: number): string => {
			return `${formatBytes(bytesPerSecond)}/s`;
		};

		const formatTime = (seconds: number): string => {
			if (seconds < 60) return `${Math.round(seconds)}s`;
			const mins = Math.floor(seconds / 60);
			const secs = Math.round(seconds % 60);
			return `${mins}m ${secs}s`;
		};

		// Use MultiBar if provided (for parallel downloads), otherwise use SingleBar
		const progressBar = multiBar
			? multiBar.create(100, 0, {
					title: displayTitle.padEnd(30),
					speed: '0 B/s',
					size: '0 B',
					eta: '0s',
				})
			: new cliProgress.SingleBar({
					format: `  ${displayTitle.padEnd(30)} |{bar}| {percentage}% | {speed} | ETA: {eta} | {size}`,
					barCompleteChar: '\u2588',
					barIncompleteChar: '\u2591',
					hideCursor: true,
					clearOnComplete: true,
				});

		const childProcess = spawn(command, args, {
			cwd: process.cwd(),
			shell: false,
		});

		// Limit buffer sizes to prevent memory leaks (max 100KB each - more aggressive)
		const MAX_BUFFER_SIZE = 100 * 1024;
		let stdout = '';
		let stderr = '';
		let progressStarted = false;
		let lastProgress = 0;
		let buffer = '';

		// Progress tracking for speed and ETA calculation
		let totalSize = 0; // Total file size in bytes
		let downloadedBytes = 0; // Bytes downloaded so far
		let lastUpdateTime = Date.now();
		let lastDownloadedBytes = 0;
		let currentSpeed = 0; // Bytes per second
		let eta = 0; // Estimated time remaining in seconds

		const parseProgress = (output: string): boolean => {
			// Parse file size patterns (e.g., "Size: 123.45 MB", "Total: 500MB", "File size: 1.2GB")
			const sizePatterns = [
				/size[:\s]+(\d+\.?\d*)\s*(B|KB|MB|GB)/gi,
				/total[:\s]+(\d+\.?\d*)\s*(B|KB|MB|GB)/gi,
				/file\s+size[:\s]+(\d+\.?\d*)\s*(B|KB|MB|GB)/gi,
			];

			for (const pattern of sizePatterns) {
				const match = pattern.exec(output);
				if (match) {
					const value = Number.parseFloat(match[1]);
					const unit = match[2].toUpperCase();
					const multipliers: Record<string, number> = {
						B: 1,
						KB: 1024,
						MB: 1024 * 1024,
						GB: 1024 * 1024 * 1024,
					};
					if (multipliers[unit]) {
						totalSize = value * multipliers[unit];
					}
				}
			}

			// Parse downloaded bytes (e.g., "Downloaded: 123.45 MB / 500 MB")
			const downloadedPattern = /downloaded[:\s]+(\d+\.?\d*)\s*(B|KB|MB|GB)/gi;
			const downloadedMatch = downloadedPattern.exec(output);
			if (downloadedMatch) {
				const value = Number.parseFloat(downloadedMatch[1]);
				const unit = downloadedMatch[2].toUpperCase();
				const multipliers: Record<string, number> = {
					B: 1,
					KB: 1024,
					MB: 1024 * 1024,
					GB: 1024 * 1024 * 1024,
				};
				if (multipliers[unit]) {
					downloadedBytes = value * multipliers[unit];
				}
			}

			// Multiple patterns to catch different output formats from N_m3u8DL-RE
			// Pattern 1: "Progress: 50.0%" or "50.0%"
			// Pattern 2: "Downloaded: 50%" or "[50%]"
			// Pattern 3: "Segment 10/20" (calculate percentage)
			const patterns = [
				/(\d+\.?\d*)%/g, // Percentage pattern
				/\[(\d+\.?\d*)%\]/g, // Bracketed percentage
				/segment\s+(\d+)\/(\d+)/gi, // Segment progress
				/downloaded\s+(\d+\.?\d*)%/gi, // Downloaded percentage
			];

			let foundProgress = false;

			for (const pattern of patterns) {
				let match: RegExpExecArray | null = pattern.exec(output);
				while (match !== null) {
					let progress = 0;

					if (match.length === 3) {
						// Segment pattern: calculate percentage
						const current = Number.parseInt(match[1], 10);
						const total = Number.parseInt(match[2], 10);
						if (total > 0) {
							progress = (current / total) * 100;
						}
					} else {
						progress = Number.parseFloat(match[1]);
					}

					if (progress > 0 && progress <= 100) {
						if (!progressStarted) {
							progressStarted = true;
							if (!multiBar) {
								progressBar.start(100, 0);
							}
						}
						const roundedProgress = Math.min(100, Math.max(0, Math.round(progress)));

						// Calculate downloaded bytes from progress if we have total size
						if (totalSize > 0) {
							downloadedBytes = (progress / 100) * totalSize;
						}

						// Calculate speed and ETA
						const now = Date.now();
						const timeDelta = (now - lastUpdateTime) / 1000; // seconds
						if (timeDelta > 0.5) {
							// Update speed every 0.5 seconds
							const bytesDelta = downloadedBytes - lastDownloadedBytes;
							currentSpeed = bytesDelta / timeDelta;
							lastUpdateTime = now;
							lastDownloadedBytes = downloadedBytes;

							// Calculate ETA
							if (currentSpeed > 0 && totalSize > 0) {
								const remainingBytes = totalSize - downloadedBytes;
								eta = remainingBytes / currentSpeed;
							} else if (currentSpeed > 0 && progress > 0) {
								// Estimate ETA from progress rate
								const remainingProgress = 100 - progress;
								const progressRate = progress / (timeDelta * 100); // progress per second
								if (progressRate > 0) {
									eta = remainingProgress / progressRate;
								}
							}
						}

						if (roundedProgress !== lastProgress) {
							const speedStr = formatSpeed(currentSpeed);
							const sizeStr = totalSize > 0 ? formatBytes(totalSize) : formatBytes(downloadedBytes);
							const etaStr = formatTime(eta);

							if (multiBar) {
								progressBar.update(roundedProgress, {
									title: displayTitle.padEnd(30),
									speed: speedStr,
									size: sizeStr,
									eta: etaStr,
								});
							} else {
								progressBar.update(roundedProgress, {
									speed: speedStr,
									size: sizeStr,
									eta: etaStr,
								});
							}
							lastProgress = roundedProgress;
						}
						foundProgress = true;
					}
					match = pattern.exec(output);
				}
			}
			return foundProgress;
		};

		const processOutput = (data: Buffer): void => {
			const output = data.toString();
			buffer += output;

			// Process line by line for better parsing
			const lines = buffer.split('\n');
			buffer = lines.pop() || ''; // Keep incomplete line in buffer

			for (const line of lines) {
				parseProgress(line);

				// Look for completion indicators
				if (
					line.includes('Download completed') ||
					line.includes('Merging') ||
					line.includes('Done') ||
					line.includes('Successfully')
				) {
					if (progressStarted) {
						const speedStr = formatSpeed(currentSpeed);
						const sizeStr = totalSize > 0 ? formatBytes(totalSize) : formatBytes(downloadedBytes);
						if (multiBar) {
							progressBar.update(100, {
								title: displayTitle.padEnd(30),
								speed: speedStr,
								size: sizeStr,
								eta: '0s',
							});
						} else {
							progressBar.update(100, {
								speed: speedStr,
								size: sizeStr,
								eta: '0s',
							});
						}
					}
				}
			}
		};

		childProcess.stdout.on('data', (data: Buffer) => {
			const dataStr = data.toString();
			// Limit stdout buffer size to prevent memory leaks - keep only last portion
			stdout += dataStr;
			if (stdout.length > MAX_BUFFER_SIZE) {
				stdout = stdout.slice(-MAX_BUFFER_SIZE);
			}
			processOutput(data);
		});

		childProcess.stderr.on('data', (data: Buffer) => {
			const dataStr = data.toString();
			// Limit stderr buffer size to prevent memory leaks - keep only last portion
			stderr += dataStr;
			if (stderr.length > MAX_BUFFER_SIZE) {
				stderr = stderr.slice(-MAX_BUFFER_SIZE);
			}
			processOutput(data);
		});

		childProcess.on('close', (code: number | null) => {
			// Process remaining buffer
			if (buffer) {
				parseProgress(buffer);
			}

			if (progressStarted) {
				const speedStr = formatSpeed(currentSpeed);
				const sizeStr = totalSize > 0 ? formatBytes(totalSize) : formatBytes(downloadedBytes);
				if (multiBar) {
					progressBar.update(100, {
						title: displayTitle.padEnd(30),
						speed: speedStr,
						size: sizeStr,
						eta: '0s',
					});
					// Remove the bar from MultiBar to free memory and clear display
					multiBar.remove(progressBar);
				} else {
					progressBar.update(100, {
						speed: speedStr,
						size: sizeStr,
						eta: '0s',
					});
					progressBar.stop();
				}
			}

			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				reject(new Error(`Process exited with code ${code}. ${stderr}`));
			}
		});

		childProcess.on('error', (error: Error) => {
			if (progressStarted) {
				if (multiBar) {
					multiBar.remove(progressBar);
				} else {
					progressBar.stop();
				}
			}
			reject(error);
		});
	});
}
