import * as path from 'path';
import * as fs from 'fs';

function getExecutablePath(): string {
    return path.join(process.cwd(), 'dist', 'index.js');
}

console.log('Operating system detected:', process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux');

const indexPath = getExecutablePath();

process.on('uncaughtException', (error: Error) => {
    console.error('Uncaught error:', error);
    process.exit(1);
});

try {
    if (process.platform === 'win32') {
        console.error('Windows not supported.');
        process.exit(1);
    } else {
        // Check if the file exists
        if (!fs.existsSync(indexPath)) {
            console.error(`Error: Could not find index.js at ${indexPath}`);
            console.error('Make sure you have built the project with: npm run build');
            process.exit(1);
        }
        
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const indexModule = require(indexPath);
        indexModule.main().catch((error: Error) => {
            console.error('Error in main:', error);
            process.exit(1);
        });
    }
} catch (error) {
    const err = error as Error;
    console.error('Error loading file:', err);
    console.error('Stack trace:', err.stack);
    process.exit(1);
}

