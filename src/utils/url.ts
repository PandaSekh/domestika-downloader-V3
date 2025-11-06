import type { NormalizedUrl } from '../types';

// Function to normalize Domestika URLs
export function normalizeDomestikaUrl(url: string): NormalizedUrl {
	const courseRegex = /domestika\.org\/.*?\/courses\/(\d+)-([-\w]+)/;
	const match = url.match(courseRegex);

	if (match) {
		// Extract and clean the course title
		const rawTitle = match[2]
			.replace(/-/g, ' ') // Replace hyphens with spaces
			.split(' ')
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize each word
			.join(' ');

		return {
			url: `https://www.domestika.org/es/courses/${match[1]}/course`,
			courseTitle: rawTitle,
		};
	}

	return { url: url, courseTitle: null };
}
