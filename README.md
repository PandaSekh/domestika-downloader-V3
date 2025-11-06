# Domestika Course Downloader V3

A tool to download Domestika courses you have purchased. This version is tested on macOS and Linux/Unix systems.

⚠️ **IMPORTANT:** This tool only works with courses you have purchased. You must be the legitimate owner of the courses you want to download.

## How It Works

The downloader uses your Domestika session cookies to authenticate and download course videos. It:

1. Accepts course URLs in any format (main page, specific units, or course pages)
2. Authenticates using cookies stored in a `.env` file
3. Downloads videos using `N_m3u8DL-RE` for HLS streams
4. Processes videos with `ffmpeg` to embed subtitles and convert to MP4
5. Organizes downloads by course and section

## Features

- **Multiple course downloads**: Download several courses simultaneously
- **Flexible URL support**: Accepts any Domestika URL format:
  - Course main page: `https://www.domestika.org/en/courses/1234-course-name`
  - Specific unit: `https://www.domestika.org/en/courses/1234-course-name/units/5678-unit`
  - Course page: `https://www.domestika.org/en/courses/1234-course-name/course`
- **Subtitle support**: Download subtitles in multiple languages (Spanish, English, Portuguese, French, German, Italian)
  - Subtitles are embedded as tracks in the MP4 video
  - Independent SRT files are also generated
- **Automatic credential management**: Cookies are stored securely in `.env` and validated automatically
- **Parallel downloads**: Multiple videos download simultaneously for faster processing
- **Progress tracking**: Detailed progress information for each download
- **Error handling**: Automatic retry with cookie refresh when authentication fails

## Prerequisites

### macOS
1. **ffmpeg**:
   ```bash
   brew install ffmpeg
   ```

### Linux/Unix
1. **ffmpeg**:
   - Ubuntu/Debian:
     ```bash
     sudo apt update && sudo apt install ffmpeg
     ```
   - Fedora/RHEL:
     ```bash
     sudo dnf install ffmpeg
     ```
   - Arch Linux:
     ```bash
     sudo pacman -S ffmpeg
     ```
   - Or install from [ffmpeg.org](https://ffmpeg.org/download.html)

### All Platforms
2. **N_m3u8DL-RE**:
   - Download the appropriate binary for your platform from [GitHub releases](https://github.com/nilaoda/N_m3u8DL-RE/releases)
   - Place it in the project folder
   - Make sure the name is `N_m3u8DL-RE` (without extension on Unix-like systems, or `N_m3u8DL-RE.exe` on Windows)
   - Make it executable (Unix-like systems):
     ```bash
     chmod +x N_m3u8DL-RE
     ```

3. **Node.js and npm**

## Installation

1. Clone the repository:
   ```bash
   git clone [REPOSITORY_URL]
   cd domestika-downloader-V2
   ```

2. Install dependencies:
   ```bash
   npm i
   ```

## Usage

1. Run the program:
   ```bash
   npm start
   ```

2. **First-time setup** (if cookies are not configured):
   - The program will prompt you to provide your Domestika cookies
   - Open your browser's Developer Tools (F12)
   - Go to Storage → Cookies
   - Copy the values for:
     - `_domestika_session`
     - `_credentials`
   - Cookies are saved to `.env` automatically

3. **Enter course URLs**:
   - Enter one or multiple URLs separated by spaces
   - Any valid Domestika course URL format is accepted

4. **Select subtitles**:
   - Choose if you want to download subtitles
   - Select your preferred language

5. **Monitor downloads**:
   - Progress is shown for each video
   - If authentication fails, you'll be prompted to update cookies

## Configuration

### Download Path

Set a custom download location by adding to your `.env` file:

```
DOWNLOAD_PATH=/path/to/your/downloads/courses
```

- Use an absolute path for a specific location
- Use a relative path (e.g., `./my_courses`) for a folder in the project directory
- If not set, defaults to `domestika_courses/` in the project directory

### Credentials

Cookies are stored in `.env` and automatically validated. If cookies expire or become invalid, the program will prompt you to update them.

## File Structure

Downloads are organized as follows:

```
[DOWNLOAD_PATH]/
└── Course Name/
    └── Section/
        ├── Course Name - U1 - 1_Video Name.mp4
        └── Course Name - U1 - 1_Video Name.srt
```