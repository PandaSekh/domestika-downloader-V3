import * as cheerio from 'cheerio';
import type { Page } from 'puppeteer';
import type { VideoData } from '../types';

interface InitialPropsVideo {
	video: {
		playbackURL: string;
		title: string;
	};
}

interface InitialProps {
	videos?: InitialPropsVideo[];
}

export async function getInitialProps(url: string, page: Page): Promise<VideoData[]> {
	await page.goto(url);
	const data = (await page.evaluate(() => {
		// Access __INITIAL_PROPS__ from the page's global scope
		const globalScope = globalThis as Record<string, unknown>;
		const props =
			globalScope.__INITIAL_PROPS__ ||
			(globalScope.window as { __INITIAL_PROPS__?: unknown } | undefined)?.__INITIAL_PROPS__;
		return props;
	})) as InitialProps | null | undefined;

	const html = await page.content();
	const $ = cheerio.load(html);

	const section = $('h2.h3.course-header-new__subtitle')
		.text()
		.trim()
		.replace(/[/\\?%*:|"<>]/g, '-');

	const videoData: VideoData[] = [];

	if (data?.videos && data.videos.length > 0) {
		for (let i = 0; i < data.videos.length; i++) {
			const el = data.videos[i];
			if (el?.video?.playbackURL && el?.video?.title) {
				videoData.push({
					playbackURL: el.video.playbackURL,
					title: el.video.title.replace(/\./g, '').trim(),
					section: section,
				});
				console.log(`Video found: ${el.video.title}`);
			}
		}
	}

	return videoData;
}
