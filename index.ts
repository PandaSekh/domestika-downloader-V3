import * as fs from 'fs';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { spawn } from 'child_process';
import puppeteer, { Page } from 'puppeteer';
import * as cheerio from 'cheerio';
import * as path from 'path';
import { parse as csvParseSync } from 'csv-parse/sync';
import { stringify as csvStringifySync } from 'csv-stringify/sync';
import * as inquirer from 'inquirer';
import * as cliProgress from 'cli-progress';
import 'dotenv/config';
import domestikaAuth, { Credentials } from './auth';

const exec = promisify(execCallback);

// Helper function to get the download path from environment variable or default
function getDownloadPath(): string {
    const envPath = process.env.DOWNLOAD_PATH;
    if (envPath) {
        // If it's an absolute path, use it as-is
        if (path.isAbsolute(envPath)) {
            return envPath;
        }
        // If it's a relative path, resolve it relative to current working directory
        return path.resolve(process.cwd(), envPath);
    }
    // Default to domestika_courses in current working directory
    return path.resolve(process.cwd(), 'domestika_courses');
}

// Helper function to get the path to N_m3u8DL-RE binary
function getN3u8DLPath(): string {
    const binaryName = process.platform === 'win32' ? 'N_m3u8DL-RE.exe' : 'N_m3u8DL-RE';
    const devPath = path.join(process.cwd(), binaryName);
    if (fs.existsSync(devPath)) {
        return devPath;
    }
    return `./${binaryName}`;
}

interface NormalizedUrl {
    url: string;
    courseTitle: string | null;
}

interface CSVCourse {
    url: string;
    subtitles: string | null;
    downloadOption: string;
}

interface CourseToProcess {
    url: string;
    courseTitle: string | null;
    subtitles: string[] | null;
    downloadOption: string;
}

interface VideoData {
    playbackURL: string;
    title: string;
    section: string;
}

interface Unit {
    title: string;
    videoData: VideoData[];
    unitNumber: number;
}

interface VideoSelection {
    unit: Unit;
    videoData: VideoData;
    index: number;
}

interface InquirerAnswers {
    courseUrls: string;
    subtitles: string[];
    downloadOption: 'all' | 'specific';
}

// Helper function to parse subtitle languages from string (comma-separated) to array
function parseSubtitleLanguages(subtitles: string | null): string[] | null {
    if (!subtitles || subtitles.trim() === '') {
        return null;
    }
    return subtitles.split(',').map(lang => lang.trim()).filter(lang => lang.length > 0);
}

// Function to check and install dependencies
async function checkAndInstallDependencies(): Promise<void> {
    const requiredModules: Record<string, () => unknown> = {
        'inquirer': () => inquirer,
        'cheerio': () => cheerio,
        'puppeteer': () => puppeteer,
        'dotenv': () => {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            require('dotenv');
        },
        'cli-progress': () => cliProgress,
        'csv-parse': () => {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            require('csv-parse/sync');
        },
        'csv-stringify': () => {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            require('csv-stringify/sync');
        }
    };

    const missingModules: string[] = [];

    for (const [moduleName, requireFn] of Object.entries(requiredModules)) {
        try {
            requireFn();
            console.log(`✓ ${moduleName} is installed`);
        } catch (error) {
            console.log(`✗ ${moduleName} is not installed`);
            missingModules.push(moduleName);
        }
    }

    if (missingModules.length > 0) {
        console.log(`\nInstalling missing dependencies: ${missingModules.join(', ')}...`);
        try {
            await exec(`npm install ${missingModules.join(' ')}`);
            console.log('Dependencies installed successfully.');
            
            // Restart the program after installing dependencies
            console.log('Restarting the program...\n');
            process.exit(0); // Exit with code 0 to indicate it's not an error
        } catch (error) {
            const err = error as Error;
            throw new Error(`Error installing dependencies: ${err.message}`);
        }
    }
}

// Function to normalize Domestika URLs
function normalizeDomestikaUrl(url: string): NormalizedUrl {
    const courseRegex = /domestika\.org\/.*?\/courses\/(\d+)-([-\w]+)/;
    const match = url.match(courseRegex);
    
    if (match) {
        // Extract and clean the course title
        const rawTitle = match[2]
            .replace(/-/g, ' ')  // Replace hyphens with spaces
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize each word
            .join(' ');
        
        return {
            url: `https://www.domestika.org/es/courses/${match[1]}/course`,
            courseTitle: rawTitle
        };
    }
    
    return { url: url, courseTitle: null };
}

// Function to read courses from input.csv
function readInputCSV(): CSVCourse[] | null {
    const inputFile = 'input.csv';
    if (!fs.existsSync(inputFile)) {
        return null;
    }

    try {
        const content = fs.readFileSync(inputFile, 'utf-8');
        const records = csvParseSync(content, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            delimiter: ';'
        }) as Record<string, string>[];

        // Expected format: url, subtitles (optional), downloadOption (optional)
        return records.map(row => ({
            url: row.url || row.URL || row.course_url || row.courseUrl,
            subtitles: row.subtitles || row.subtitle || row.sub || null,
            downloadOption: row.downloadOption || row.download_option || row.option || 'all'
        })).filter(row => row.url) as CSVCourse[]; // Filter out rows without URLs
    } catch (error) {
        const err = error as Error;
        throw new Error(`Error reading input.csv: ${err.message}`);
    }
}

// Function to load progress from progress.csv
function loadProgress(): Set<string> {
    const progressFile = 'progress.csv';
    if (!fs.existsSync(progressFile)) {
        return new Set<string>();
    }

    try {
        const content = fs.readFileSync(progressFile, 'utf-8');
        const records = csvParseSync(content, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        }) as Record<string, string>[];

        // Create a set of completed course URLs (only count "completed" status)
        const completed = new Set<string>();
        records.forEach(row => {
            const url = row.url || row.URL || row.course_url || row.courseUrl;
            const status = row.status || row.Status || '';
            // Only add courses that are marked as "completed"
            if (url && status.toLowerCase() === 'completed') {
                // Normalize URL for comparison
                const normalized = normalizeDomestikaUrl(url);
                completed.add(normalized.url);
            }
        });
        return completed;
    } catch (error) {
        const err = error as Error;
        console.warn(`Warning: Could not read progress.csv: ${err.message}`);
        return new Set<string>();
    }
}

// Function to save progress to progress.csv
function saveProgress(courseUrl: string, courseTitle: string | null, status: string = 'completed'): void {
    const progressFile = 'progress.csv';
    const normalized = normalizeDomestikaUrl(courseUrl);
    
    // Check if entry already exists
    let records: Record<string, string>[] = [];
    if (fs.existsSync(progressFile)) {
        try {
            const content = fs.readFileSync(progressFile, 'utf-8');
            records = csvParseSync(content, {
                columns: true,
                skip_empty_lines: true,
                trim: true
            }) as Record<string, string>[];
        } catch (error) {
            const err = error as Error;
            console.warn(`Warning: Could not read existing progress.csv: ${err.message}`);
        }
    }

    // Check if this course is already in progress
    const existingIndex = records.findIndex(row => {
        const rowUrl = row.url || row.URL || row.course_url || row.courseUrl;
        if (rowUrl) {
            const rowNormalized = normalizeDomestikaUrl(rowUrl);
            return rowNormalized.url === normalized.url;
        }
        return false;
    });

    const entry: Record<string, string> = {
        url: normalized.url,
        courseTitle: courseTitle || normalized.courseTitle || '',
        status: status,
        timestamp: new Date().toISOString()
    };

    if (existingIndex >= 0) {
        records[existingIndex] = entry;
    } else {
        records.push(entry);
    }

    // Write back to CSV
    try {
        const csvContent = csvStringifySync(records, {
            header: true,
            columns: ['url', 'courseTitle', 'status', 'timestamp']
        });
        fs.writeFileSync(progressFile, csvContent, 'utf-8');
    } catch (error) {
        const err = error as Error;
        console.error(`Error writing progress.csv: ${err.message}`);
    }
}

// Main function
export async function main(): Promise<void> {
    try {
        console.log('Starting Domestika Downloader...');
        
        // Check and install dependencies
        await checkAndInstallDependencies();
        
        // Get credentials
        const auth = await domestikaAuth.getCookies();
        
        // Check for input.csv file first
        const csvCourses = readInputCSV();
        let answers: InquirerAnswers | undefined;
        let coursesToProcess: CourseToProcess[] = [];
        
        if (csvCourses && csvCourses.length > 0) {
            console.log(`\n📋 Found ${csvCourses.length} courses in input.csv`);
            
            // Load progress to filter out already completed courses
            const completed = loadProgress();
            const pendingCourses = csvCourses.filter(course => {
                const normalized = normalizeDomestikaUrl(course.url);
                return !completed.has(normalized.url);
            });
            
            if (pendingCourses.length === 0) {
                console.log('✅ All courses from input.csv have already been completed!');
                return;
            }
            
            console.log(`📊 Progress: ${csvCourses.length - pendingCourses.length}/${csvCourses.length} completed`);
            console.log(`📥 Processing ${pendingCourses.length} pending course(s)...\n`);
            
            // Convert CSV courses to the format expected by the processing loop
            coursesToProcess = pendingCourses.map(course => {
                const normalized = normalizeDomestikaUrl(course.url);
                return {
                    url: normalized.url,
                    courseTitle: normalized.courseTitle,
                    subtitles: parseSubtitleLanguages(course.subtitles),
                    downloadOption: course.downloadOption || 'all'
                };
            });
        } else if (process.argv.length > 2) {
            // Check for command-line arguments
            const args = process.argv.slice(2);
            // Use command-line arguments if provided
            const courseUrls = args[0];
            const subtitles = args[1] || null; // Optional subtitle language
            const downloadOption = args[2] || 'all'; // Optional download option (default: all)
            
            // Validate URL
            const urls = courseUrls.trim().split(' ');
            const validUrls = urls.every(url => {
                return url.match(/domestika\.org\/.*?\/courses\/\d+[-\w]+/);
            });
            
            if (!validUrls) {
                throw new Error('Please provide valid Domestika course URLs');
            }
            
            // Convert command-line args to course format
            const normalizedUrls = urls.map(url => normalizeDomestikaUrl(url));
            const parsedSubtitles = parseSubtitleLanguages(subtitles);
            coursesToProcess = normalizedUrls.map(urlInfo => ({
                url: urlInfo.url,
                courseTitle: urlInfo.courseTitle,
                subtitles: parsedSubtitles,
                downloadOption: downloadOption
            }));
            
            console.log('Using command-line arguments:');
            console.log(`  Course URLs: ${courseUrls}`);
            console.log(`  Subtitles: ${parsedSubtitles ? parsedSubtitles.join(', ') : 'None'}`);
            console.log(`  Download Option: ${downloadOption}`);
        } else {
            // Ask user for options interactively
            answers = await inquirer.prompt<InquirerAnswers>([
            {
                type: 'input',
                name: 'courseUrls',
                message: 'Course URLs (separated by spaces):',
                validate: (input: string) => {
                    const urls = input.trim().split(' ');
                    const validUrls = urls.every(url => {
                        // Verify that it's a Domestika course URL
                        return url.match(/domestika\.org\/.*?\/courses\/\d+[-\w]+/);
                    });
                    if (validUrls) {
                        return true;
                    }
                    return 'Please enter valid Domestika course URLs';
                }
            },
            {
                type: 'list',
                name: 'subtitles',
                message: 'Do you want to download subtitles?',
                choices: [
                    { name: 'Don\'t download subtitles', value: null },
                    { name: 'Spanish', value: 'es' },
                    { name: 'English', value: 'en' },
                    { name: 'Portuguese', value: 'pt' },
                    { name: 'French', value: 'fr' },
                    { name: 'German', value: 'de' },
                    { name: 'Italian', value: 'it' }
                ]
            },
            {
                type: 'list',
                name: 'downloadOption',
                message: 'What do you want to download?',
                choices: [
                    { name: 'Entire course', value: 'all' },
                    { name: 'Specific videos', value: 'specific' }
                ]
            }
            ]);
            
            // Convert interactive answers to course format
            const urls = answers.courseUrls.trim().split(' ');
            coursesToProcess = urls.map(url => {
                const normalized = normalizeDomestikaUrl(url);
                return {
                    url: normalized.url,
                    courseTitle: normalized.courseTitle,
                    subtitles: answers?.subtitles || null,
                    downloadOption: answers?.downloadOption || 'all'
                };
            });
        }

        // Check N_m3u8DL-RE
        const N_M3U8DL_RE = getN3u8DLPath();
        if (!fs.existsSync(N_M3U8DL_RE)) {
            throw new Error(`${N_M3U8DL_RE} not found! Download the Binary here: https://github.com/nilaoda/N_m3u8DL-RE/releases`);
        }

        // Display courses to be processed
        if (coursesToProcess.length === 0) {
            console.log('No courses to process.');
            return;
        }

        console.log(`\n${coursesToProcess.length} course(s) will be processed:`);
        coursesToProcess.forEach((course, index) => {
            console.log(`${index + 1}. ${course.url} (${course.courseTitle || 'Unknown'})`);
        });

        // Process each course
        for (let i = 0; i < coursesToProcess.length; i++) {
            const course = coursesToProcess[i];
            console.log(`\n📚 Processing course ${i + 1} of ${coursesToProcess.length}: ${course.courseTitle || course.url}`);
            
            try {
                // Update progress to "processing" before starting
                saveProgress(course.url, course.courseTitle, 'processing');
                
                // Process the course
                await scrapeSite(course.url, course.subtitles, auth, course.downloadOption, course.courseTitle);
                
                // Mark as completed
                saveProgress(course.url, course.courseTitle, 'completed');
                console.log(`✅ Course completed: ${course.courseTitle || course.url}`);
            } catch (error) {
                // Mark as failed
                const err = error as Error;
                saveProgress(course.url, course.courseTitle, 'failed');
                console.error(`❌ Course failed: ${course.courseTitle || course.url} - ${err.message}`);
                // Continue with next course instead of stopping
            }
        }
        
        console.log('\n✅ All courses have been processed');
        
    } catch (error) {
        const err = error as Error;
        console.error('Error:', err.message);
        process.exit(1);
    }
}

// Start the application
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (require.main === module) {
    main().catch((error: Error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

// ... rest of the functions (scrapeSite, downloadVideo, etc.) ...

async function scrapeSite(
    courseUrl: string,
    subtitle_langs: string[] | null,
    auth: Credentials,
    downloadOption: string,
    courseTitle: string | null
): Promise<void> {
    // Configure Puppeteer
    const puppeteerOptions: Parameters<typeof puppeteer.launch>[0] = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    };
    
    const browser = await puppeteer.launch(puppeteerOptions);
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(0);
    await page.setCookie(...auth.cookies);

    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (req.resourceType() === 'stylesheet' || req.resourceType() === 'font' || req.resourceType() === 'image') {
            req.abort();
        } else {
            req.continue();
        }
    });

    await page.goto(courseUrl);
    const html = await page.content();
    const $ = cheerio.load(html);

    console.log('Analyzing site');

    const allVideos: Unit[] = [];
    const units = $('h4.h2.unit-item__title a');

    // Check if we're on the correct page
    if (units.length === 0) {
        await page.close();
        await browser.close();

        console.log('\n❌ No videos found. This may be due to invalid cookies.');
        
        const answer = await inquirer.prompt<{ updateCookies: boolean }>([
            {
                type: 'confirm',
                name: 'updateCookies',
                message: 'Do you want to update the cookies?',
                default: true
            }
        ]);

        if (answer.updateCookies) {
            // Force credential update
            await domestikaAuth.promptForCredentials(true);
            // Try again with new credentials
            return scrapeSite(courseUrl, subtitle_langs, await domestikaAuth.getCookies(), downloadOption, courseTitle);
        } else {
            throw new Error('Cannot download videos without valid cookies.');
        }
    }

    console.log(`Course: ${courseTitle}`);
    console.log(`${units.length} Units detected`);

    for (let i = 0; i < units.length; i++) {
        const unitHref = $(units[i]).attr('href');
        if (!unitHref) continue;
        
        const videoData = await getInitialProps(unitHref, page);
        allVideos.push({
            title: $(units[i])
                .text()
                .replace(/\./g, '')
                .trim()
                .replace(/[/\\?%*:|"<>]/g, '-'),
            videoData: videoData,
            unitNumber: i + 1
        });
    }

    // If user chose to download specific videos
    if (downloadOption === 'specific') {
        const videoChoices = allVideos.flatMap(unit => {
            // Create separator/header for the unit
            const unitHeader = {
                name: `Unit ${unit.unitNumber}: ${unit.title}`,
                value: `unit_${unit.unitNumber}`,
                checked: false
            };

            // Create options for each video with indentation
            const unitVideos = unit.videoData.map((vData, index) => ({
                name: `    ${index + 1}. ${vData.title}`,
                value: {
                    unit: unit,
                    videoData: vData,
                    index: index + 1
                },
                short: vData.title
            }));

            return [unitHeader, ...unitVideos];
        });

        const selectedVideos = await inquirer.prompt<{ videosToDownload: (string | VideoSelection)[] }>([
            {
                type: 'checkbox',
                name: 'videosToDownload',
                message: 'Select complete units or specific videos:',
                choices: videoChoices,
                pageSize: 20,
                loop: false
            }
        ]);

        // Process selections
        for (const selection of selectedVideos.videosToDownload) {
            if (typeof selection === 'string' && selection.startsWith('unit_')) {
                // If a complete unit was selected
                const unitNumber = parseInt(selection.split('_')[1]);
                const unit = allVideos.find(u => u.unitNumber === unitNumber);
                
                if (unit) {
                    for (let i = 0; i < unit.videoData.length; i++) {
                        await downloadVideo(
                            unit.videoData[i],
                            courseTitle,
                            unit.title,
                            i + 1,
                            subtitle_langs,
                            unit.unitNumber
                        );
                    }
                }
            } else if (typeof selection === 'object' && 'videoData' in selection) {
                // If a specific video was selected
                await downloadVideo(
                    selection.videoData,
                    courseTitle,
                    selection.unit.title,
                    selection.index,
                    subtitle_langs,
                    selection.unit.unitNumber
                );
            }
        }

        await page.close();
        await browser.close();
        return;
    }

    // If we reach here it's because downloadOption === 'all'
    console.log('Downloading entire course...');
    let completedVideos = 0;
    const totalVideos = allVideos.reduce((acc, unit) => acc + unit.videoData.length, 0);

    // Create a MultiBar for parallel downloads to avoid progress bar conflicts
    const multiBar = new cliProgress.MultiBar({
        format: '  {title} |{bar}| {percentage}% | ETA: {eta}s',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true,
        clearOnComplete: false,
        stopOnComplete: false
    });

    // Use only the parallel method to download the entire course
    const downloadPromises: Promise<boolean>[] = [];

    for (let i = 0; i < allVideos.length; i++) {
        const unit = allVideos[i];
        for (let a = 0; a < unit.videoData.length; a++) {
            const vData = unit.videoData[a];
            if (!vData || !vData.playbackURL) {
                console.error(`Error: Invalid video data for ${unit.title} #${a}`);
                continue;
            }

            downloadPromises.push(
                (async (): Promise<boolean> => {
                    try {
                        console.log(`\nStarting download: ${vData.title}`);
                        await downloadVideo(vData, courseTitle, unit.title, a + 1, subtitle_langs, unit.unitNumber, multiBar);
                        completedVideos++;
                        console.log(`\nCompleted ${completedVideos} of ${totalVideos} videos`);
                        return true;
                    } catch (error) {
                        const err = error as Error;
                        console.error(`Error in video ${vData.title}:`, err);
                        return false;
                    }
                })()
            );
        }
    }

    await Promise.all(downloadPromises);
    
    // Stop the MultiBar after all downloads complete
    multiBar.stop();

    if (completedVideos === 0) {
        console.log('\n❌ Could not download any videos. This may be due to invalid cookies.');
        
        const answer = await inquirer.prompt<{ updateCookies: boolean }>([
            {
                type: 'confirm',
                name: 'updateCookies',
                message: 'Do you want to update the cookies?',
                default: true
            }
        ]);

        if (answer.updateCookies) {
            // Force credential update
            await domestikaAuth.promptForCredentials(true);
            // Try again with new credentials
            return scrapeSite(courseUrl, subtitle_langs, await domestikaAuth.getCookies(), downloadOption, courseTitle);
        }
    } else {
        console.log(`\nProcess completed. Completed ${completedVideos} of ${totalVideos} videos`);
    }

    await page.close();
    await browser.close();
}

async function getInitialProps(url: string, page: Page): Promise<VideoData[]> {
    await page.goto(url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        return (globalThis as any).__INITIAL_PROPS__ || (globalThis as any).window?.__INITIAL_PROPS__;
    });
    const html = await page.content();
    const $ = cheerio.load(html);

    const section = $('h2.h3.course-header-new__subtitle')
        .text()
        .trim()
        .replace(/[/\\?%*:|"<>]/g, '-');

    const videoData: VideoData[] = [];

    if (data && data.videos && data.videos.length > 0) {
        for (let i = 0; i < data.videos.length; i++) {
            const el = data.videos[i];
            videoData.push({
                playbackURL: el.video.playbackURL,
                title: el.video.title.replace(/\./g, '').trim(),
                section: section,
            });
            console.log('Video found: ' + el.video.title);
        }
    }

    return videoData;
}

// Function to execute N_m3u8DL-RE with progress tracking
function executeWithProgress(command: string, args: string[], videoTitle: string, multiBar?: cliProgress.MultiBar): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        // Truncate video title if too long for display
        const displayTitle = videoTitle.length > 30 ? videoTitle.substring(0, 27) + '...' : videoTitle;
        
        // Use MultiBar if provided (for parallel downloads), otherwise use SingleBar
        const progressBar = multiBar 
            ? multiBar.create(100, 0, {
                title: displayTitle.padEnd(30)
            })
            : new cliProgress.SingleBar({
                format: `  ${displayTitle.padEnd(30)} |{bar}| {percentage}% | ETA: {eta}s`,
                barCompleteChar: '\u2588',
                barIncompleteChar: '\u2591',
                hideCursor: true,
                clearOnComplete: false
            });

        const childProcess = spawn(command, args, {
            cwd: process.cwd(),
            shell: false
        });

        let stdout = '';
        let stderr = '';
        let progressStarted = false;
        let lastProgress = 0;
        let buffer = '';

        const parseProgress = (output: string): boolean => {
            // Multiple patterns to catch different output formats from N_m3u8DL-RE
            // Pattern 1: "Progress: 50.0%" or "50.0%"
            // Pattern 2: "Downloaded: 50%" or "[50%]"
            // Pattern 3: "Segment 10/20" (calculate percentage)
            const patterns = [
                /(\d+\.?\d*)%/g,  // Percentage pattern
                /\[(\d+\.?\d*)%\]/g,  // Bracketed percentage
                /segment\s+(\d+)\/(\d+)/gi,  // Segment progress
                /downloaded\s+(\d+\.?\d*)%/gi  // Downloaded percentage
            ];

            for (const pattern of patterns) {
                let match: RegExpExecArray | null;
                while ((match = pattern.exec(output)) !== null) {
                    let progress = 0;
                    
                    if (match.length === 3) {
                        // Segment pattern: calculate percentage
                        const current = parseInt(match[1]);
                        const total = parseInt(match[2]);
                        if (total > 0) {
                            progress = (current / total) * 100;
                        }
                    } else {
                        progress = parseFloat(match[1]);
                    }
                    
                    if (progress > 0 && progress <= 100) {
                        if (!progressStarted) {
                            progressStarted = true;
                            if (!multiBar) {
                                progressBar.start(100, 0);
                            }
                        }
                        const roundedProgress = Math.min(100, Math.max(0, Math.round(progress)));
                        if (roundedProgress !== lastProgress) {
                            if (multiBar) {
                                progressBar.update(roundedProgress, { title: displayTitle.padEnd(30) });
                            } else {
                                progressBar.update(roundedProgress);
                            }
                            lastProgress = roundedProgress;
                        }
                        return true;
                    }
                }
            }
            return false;
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
                if (line.includes('Download completed') || 
                    line.includes('Merging') || 
                    line.includes('Done') ||
                    line.includes('Successfully')) {
                    if (progressStarted) {
                        if (multiBar) {
                            progressBar.update(100, { title: displayTitle.padEnd(30) });
                        } else {
                            progressBar.update(100);
                        }
                    }
                }
            }
        };

        childProcess.stdout.on('data', (data: Buffer) => {
            stdout += data.toString();
            processOutput(data);
        });

        childProcess.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
            processOutput(data);
        });

        childProcess.on('close', (code: number | null) => {
            // Process remaining buffer
            if (buffer) {
                parseProgress(buffer);
            }
            
            if (progressStarted) {
                if (multiBar) {
                    progressBar.update(100, { title: displayTitle.padEnd(30) });
                    progressBar.stop();
                } else {
                    progressBar.update(100);
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
                progressBar.stop();
            }
            reject(error);
        });
    });
}

async function downloadVideo(
    vData: VideoData,
    courseTitle: string | null,
    unitTitle: string,
    index: number,
    subtitle_langs: string[] | null,
    unitNumber: number,
    multiBar?: cliProgress.MultiBar
): Promise<boolean> {
    if (!vData.playbackURL) {
        throw new Error(`Invalid video URL for ${vData.title}`);
    }

    const cleanPath = (p: string) => p.replace(/\/+/g, '/');
    const baseDownloadPath = getDownloadPath();
    const finalDir = cleanPath(path.join(baseDownloadPath, courseTitle || 'Unknown Course', vData.section, unitTitle));
    
    try {
        if (!fs.existsSync(finalDir)) {
            fs.mkdirSync(finalDir, { recursive: true });
        }
        
        const fileName = `${courseTitle} - U${unitNumber} - ${index}_${vData.title.trimEnd()}`;
        
        console.log('\nDownload information:');
        console.log('URL:', vData.playbackURL);
        console.log('Final directory:', finalDir);
        console.log('File name:', fileName);
        
        console.log('\nDownloading video...');
        
        let downloadSuccess = false;
        const N_M3U8DL_RE = getN3u8DLPath();
        
        try {
            // Try first with 1080p
            const args1080p = [
                '-sv', 'res=1920x1080',
                vData.playbackURL,
                '--save-dir', finalDir,
                '--save-name', fileName,
                '--tmp-dir', '.tmp',
                '--log-level', 'INFO' // Changed to INFO to get progress output
            ];
            
            await executeWithProgress(N_M3U8DL_RE, args1080p, vData.title, multiBar);
            downloadSuccess = true;
        } catch (error) {
            // If 1080p fails, try with best
            console.log('\n1080p quality not found, trying with best available quality...');
            const argsBest = [
                '-sv', 'for=best',
                vData.playbackURL,
                '--save-dir', finalDir,
                '--save-name', fileName,
                '--tmp-dir', '.tmp',
                '--log-level', 'INFO' // Changed to INFO to get progress output
            ];
            
            await executeWithProgress(N_M3U8DL_RE, argsBest, vData.title, multiBar);
            downloadSuccess = true;
        }

        if (downloadSuccess) {
            console.log('Video downloaded successfully');

            if (subtitle_langs && subtitle_langs.length > 0) {
                console.log(`Downloading subtitles for languages: ${subtitle_langs.join(', ')}...`);
                const subtitlePaths: string[] = [];
                
                // Download each subtitle language
                for (const lang of subtitle_langs) {
                    try {
                        console.log(`Downloading ${lang} subtitles...`);
                        const subtitleCommand = `${N_M3U8DL_RE} --auto-subtitle-fix --sub-format SRT --select-subtitle lang="${lang}":for=all "${vData.playbackURL}" --save-dir "${finalDir}" --save-name "${fileName}" --tmp-dir ".tmp" --log-level OFF`;
                        await exec(subtitleCommand, { maxBuffer: 1024 * 1024 * 100 });

                        // N_m3u8DL-RE might save subtitles with different naming patterns
                        // Try multiple possible paths
                        const possibleSubPaths = [
                            path.join(finalDir, `${fileName}.${lang}.srt`),
                            path.join(finalDir, `${fileName}.srt`),
                            path.join(finalDir, `${fileName}_${lang}.srt`),
                            path.join(finalDir, `subtitle_${lang}.srt`),
                        ];
                        
                        let subPath: string | null = null;
                        
                        // First try the expected paths
                        for (const possiblePath of possibleSubPaths) {
                            if (fs.existsSync(possiblePath)) {
                                subPath = possiblePath;
                                console.log(`Found ${lang} subtitle file: ${subPath}`);
                                break;
                            }
                        }
                        
                        // If not found, search for any .srt file with the language code in the directory
                        if (!subPath) {
                            const files = fs.readdirSync(finalDir);
                            const srtFiles = files.filter(f => 
                                f.endsWith('.srt') && (f.includes(`.${lang}.`) || f.includes(`_${lang}.`) || f.includes(`-${lang}.`))
                            );
                            if (srtFiles.length > 0) {
                                subPath = path.join(finalDir, srtFiles[0]);
                                console.log(`Found ${lang} subtitle file (searched): ${subPath}`);
                            }
                        }
                        
                        if (subPath) {
                            subtitlePaths.push(subPath);
                        } else {
                            console.warn(`Could not find ${lang} subtitle file after download`);
                        }
                    } catch (error) {
                        const err = error as Error;
                        console.error(`Error downloading ${lang} subtitles:`, err.message);
                    }
                }
                
                // Embed all subtitles if any were found
                if (subtitlePaths.length > 0) {
                    const videoPath = path.join(finalDir, `${fileName}.mp4`);
                    
                    // Verify video file exists
                    let actualVideoPath: string | null = null;
                    if (fs.existsSync(videoPath)) {
                        actualVideoPath = videoPath;
                    } else {
                        // Try to find the actual video file (might have different extension)
                        const videoFiles = fs.readdirSync(finalDir).filter(f => 
                            f.startsWith(fileName) && (f.endsWith('.mp4') || f.endsWith('.m3u8') || f.endsWith('.ts'))
                        );
                        if (videoFiles.length > 0) {
                            actualVideoPath = path.join(finalDir, videoFiles[0]);
                            console.log(`Found video file: ${actualVideoPath}`);
                        }
                    }
                    
                    if (actualVideoPath) {
                        console.log(`Embedding ${subtitlePaths.length} subtitle track(s) into video...`);
                        await embedSubtitles(actualVideoPath, subtitlePaths);
                        console.log('Subtitles embedded successfully');
                    } else {
                        console.warn(`Video file not found: ${videoPath}`);
                    }
                } else {
                    console.log('No subtitles were successfully downloaded');
                }
            }
        }

        return true;
    } catch (error) {
        const err = error as Error;
        console.error('\nDetailed error:', err);
        throw new Error(`Error downloading video: ${err.message}`);
    }
}

// Helper function to detect language code from file path
function getLanguageCode(subtitlePath: string): string {
    if (subtitlePath.includes('.en.')) return 'eng';
    if (subtitlePath.includes('.es.')) return 'spa';
    if (subtitlePath.includes('.pt.')) return 'por';
    if (subtitlePath.includes('.fr.')) return 'fra';
    if (subtitlePath.includes('.de.')) return 'deu';
    if (subtitlePath.includes('.it.')) return 'ita';
    // Try with underscore or hyphen separators
    if (subtitlePath.includes('_en.') || subtitlePath.includes('-en.')) return 'eng';
    if (subtitlePath.includes('_es.') || subtitlePath.includes('-es.')) return 'spa';
    if (subtitlePath.includes('_pt.') || subtitlePath.includes('-pt.')) return 'por';
    if (subtitlePath.includes('_fr.') || subtitlePath.includes('-fr.')) return 'fra';
    if (subtitlePath.includes('_de.') || subtitlePath.includes('-de.')) return 'deu';
    if (subtitlePath.includes('_it.') || subtitlePath.includes('-it.')) return 'ita';
    return 'und';
}

async function embedSubtitles(videoPath: string, subtitlePaths: string[]): Promise<boolean> {
    try {
        // Verify files exist
        if (!fs.existsSync(videoPath)) {
            console.error(`Error: Video file not found: ${videoPath}`);
            return false;
        }
        
        if (!subtitlePaths || subtitlePaths.length === 0) {
            console.error('Error: No subtitle files provided');
            return false;
        }
        
        // Validate all subtitle files exist
        const validSubtitlePaths: string[] = [];
        for (const subPath of subtitlePaths) {
            if (!fs.existsSync(subPath)) {
                console.warn(`Warning: Subtitle file not found: ${subPath}`);
                continue;
            }
            
            // Validate subtitle file
            const subtitleContent = fs.readFileSync(subPath, 'utf-8');
            if (subtitleContent.trim().length === 0) {
                console.warn(`Warning: Subtitle file is empty: ${subPath}`);
                continue;
            }
            
            // Basic SRT validation (should contain sequence numbers and timestamps)
            if (!subtitleContent.match(/\d+\s*\n\d{2}:\d{2}:\d{2}/)) {
                console.warn(`Warning: Subtitle file might not be in valid SRT format: ${subPath}`);
            }
            
            validSubtitlePaths.push(subPath);
        }
        
        if (validSubtitlePaths.length === 0) {
            console.error('Error: No valid subtitle files found');
            return false;
        }

        const dir = path.dirname(videoPath);
        const videoExt = path.extname(videoPath);
        const filename = path.basename(videoPath, videoExt);
        const outputPath = path.join(dir, `${filename}_with_subs${videoExt}`);

        // Build ffmpeg command with multiple subtitle inputs
        // Format: ffmpeg -i video -i sub1 -i sub2 ... -map 0:v:0 -map 0:a:0 -map 1:s:0 -map 2:s:0 ...
        let ffmpegCommand = `ffmpeg -i "${videoPath}"`;
        
        // Add all subtitle files as inputs
        for (const subPath of validSubtitlePaths) {
            ffmpegCommand += ` -i "${subPath}"`;
        }
        
        // Map video and audio streams
        ffmpegCommand += ` -map 0:v:0 -map 0:a:0`;
        
        // Map each subtitle stream and set metadata
        for (let i = 0; i < validSubtitlePaths.length; i++) {
            const subPath = validSubtitlePaths[i];
            const langCode = getLanguageCode(subPath);
            const streamIndex = i + 1; // First subtitle input is index 1 (0 is video)
            ffmpegCommand += ` -map ${streamIndex}:s:0 -c:s:${i} mov_text -metadata:s:s:${i} language=${langCode}`;
        }
        
        // Set first subtitle as default
        if (validSubtitlePaths.length > 0) {
            ffmpegCommand += ` -disposition:s:0 default`;
        }
        
        // Copy video and audio without re-encoding
        ffmpegCommand += ` -c:v copy -c:a copy "${outputPath}"`;
        
        console.log('Running ffmpeg command to embed subtitles...');
        console.log(`Command: ${ffmpegCommand.replace(/\s+/g, ' ')}`);
        
        try {
            await exec(ffmpegCommand, { maxBuffer: 1024 * 1024 * 100 });
        } catch (error) {
            // If the first command fails, try a simpler version
            console.log('First attempt failed, trying alternative method...');
            let altCommand = `ffmpeg -i "${videoPath}"`;
            for (const subPath of validSubtitlePaths) {
                altCommand += ` -i "${subPath}"`;
            }
            altCommand += ` -c:v copy -c:a copy -c:s mov_text -disposition:s:0 default "${outputPath}"`;
            await exec(altCommand, { maxBuffer: 1024 * 1024 * 100 });
        }
        
        // Verify output file was created
        if (!fs.existsSync(outputPath)) {
            console.error(`Error: Output file was not created: ${outputPath}`);
            return false;
        }

        // Get file sizes for verification
        const originalSize = fs.statSync(videoPath).size;
        const outputSize = fs.statSync(outputPath).size;
        console.log(`Original size: ${originalSize} bytes, Output size: ${outputSize} bytes`);
        
        if (outputSize < originalSize * 0.9) {
            console.warn('Warning: Output file is significantly smaller than original. This might indicate an error.');
        }
        
        // If everything went well, replace the original file
        fs.unlinkSync(videoPath);
        fs.renameSync(outputPath, videoPath);
        console.log(`Replaced original video with subtitled version (${validSubtitlePaths.length} track(s))`);
        
        // Delete all subtitle files after successful embedding
        for (const subPath of validSubtitlePaths) {
            if (fs.existsSync(subPath)) {
                fs.unlinkSync(subPath);
                console.log(`Deleted subtitle file: ${subPath}`);
            }
        }
        
        // Also delete any other .srt files with the same base name
        const baseFilename = path.basename(videoPath, videoExt);
        try {
            const files = fs.readdirSync(dir);
            const srtFiles = files.filter(f => 
                f.startsWith(baseFilename) && f.endsWith('.srt')
            );
            for (const srtFile of srtFiles) {
                const srtFilePath = path.join(dir, srtFile);
                if (fs.existsSync(srtFilePath)) {
                    fs.unlinkSync(srtFilePath);
                    console.log(`Deleted subtitle file: ${srtFilePath}`);
                }
            }
        } catch (error) {
            // Ignore errors when cleaning up subtitle files
            console.warn('Warning: Could not clean up all subtitle files');
        }
        
        return true;
    } catch (error) {
        const err = error as Error;
        console.error(`Error embedding subtitles: ${err.message}`);
        if (err.message.includes('ffmpeg')) {
            console.error('Make sure ffmpeg is installed and available in your PATH');
        }
        return false;
    }
}

