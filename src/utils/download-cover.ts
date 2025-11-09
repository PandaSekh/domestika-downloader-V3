import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as cheerio from 'cheerio';
import { debugLog } from './debug';
import { getDownloadPath } from './paths';

/**
 * Extract cover image URL from course page HTML
 */
export function extractCoverImageUrl($: cheerio.CheerioAPI): string | null {
	// Try multiple selectors for cover image
	const selectors = [
		'meta[property="og:image"]',
		'meta[name="twitter:image"]',
		'img.course-header-new__image',
		'img.course-cover',
		'.course-header img',
		'img[alt*="course"]',
	];

	for (const selector of selectors) {
		const element = $(selector).first();
		if (element.length > 0) {
			const url = element.attr('content') || element.attr('src');
			if (url) {
				// Make URL absolute if it's relative
				if (url.startsWith('//')) {
					return `https:${url}`;
				}
				if (url.startsWith('/')) {
					return `https://www.domestika.org${url}`;
				}
				if (url.startsWith('http')) {
					return url;
				}
			}
		}
	}

	return null;
}

/**
 * Download cover image to course folder
 */
export async function downloadCoverImage(
	imageUrl: string | null,
	courseTitle: string | null,
	authCookies: Array<{ name: string; value: string; domain: string }>
): Promise<void> {
	if (!imageUrl) {
		return;
	}

	try {
		// Build cookie header
		const cookieHeader = authCookies.map((c) => `${c.name}=${c.value}`).join('; ');

		// Fetch the image
		const response = await fetch(imageUrl, {
			headers: {
				Cookie: cookieHeader,
				'User-Agent':
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			},
		});

		if (!response.ok) {
			debugLog(`[COVER] Failed to download cover image: ${response.status} ${response.statusText}`);
			return;
		}

		// Determine file extension from URL or Content-Type
		const contentType = response.headers.get('content-type') || '';
		let extension = '.jpg';
		if (contentType.includes('png')) {
			extension = '.png';
		} else if (contentType.includes('webp')) {
			extension = '.webp';
		} else if (contentType.includes('jpeg') || contentType.includes('jpg')) {
			extension = '.jpg';
		} else {
			// Try to get extension from URL
			const urlExtension = path.extname(new URL(imageUrl).pathname);
			if (urlExtension) {
				extension = urlExtension;
			}
		}

		// Get the image data
		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		// Save to course folder
		const baseDownloadPath = getDownloadPath();
		const courseDir = path.join(baseDownloadPath, courseTitle || 'Unknown Course');
		if (!fs.existsSync(courseDir)) {
			fs.mkdirSync(courseDir, { recursive: true });
		}

		const coverPath = path.join(courseDir, `cover${extension}`);
		fs.writeFileSync(coverPath, buffer);
		debugLog(`[COVER] Downloaded cover image to: ${coverPath}`);
	} catch (error) {
		const err = error as Error;
		debugLog(`[COVER] Error downloading cover image: ${err.message}`);
		// Don't throw - cover image download failure shouldn't break the download process
	}
}

