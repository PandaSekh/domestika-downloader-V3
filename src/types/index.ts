export interface NormalizedUrl {
	url: string;
	courseTitle: string | null;
}

export interface CSVCourse {
	url: string;
	subtitles: string | null;
	downloadOption: string;
}

export interface CourseToProcess {
	url: string;
	courseTitle: string | null;
	subtitles: string[] | null;
	downloadOption: string;
}

export interface VideoData {
	playbackURL: string;
	title: string;
	section: string;
}

export interface Unit {
	title: string;
	videoData: VideoData[];
	unitNumber: number;
}

export interface VideoSelection {
	unit: Unit;
	videoData: VideoData;
	index: number;
}

export interface InquirerAnswers {
	courseUrls: string;
	subtitles: string[] | null;
	downloadOption: 'all' | 'specific';
}
