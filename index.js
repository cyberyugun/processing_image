const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { execSync } = require('child_process');

const app = express();
const upload = multer();
const PORT = process.env.PORT || 4000;

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Save processed image to 'output' folder
const outputFolder = path.join(__dirname, 'output');

// Ensure 'output' folder exists
if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder);
}

// Middleware to validate image size
const validateImageSize = (width, height) => {
    const MAX_WIDTH = 5000;
    const MAX_HEIGHT = 5000;
    if (width && (parseInt(width, 10) <= 0 || parseInt(width, 10) > MAX_WIDTH)) {
        return false;
    }
    if (height && (parseInt(height, 10) <= 0 || parseInt(height, 10) > MAX_HEIGHT)) {
        return false;
    }
    return true;
};

// Function to get file extension from mimetype
const getFileExtension = (originalName) => {
    const ext = path.extname(originalName);
    return ext.replace('.', '');
};

// Function to classify images using a pre-trained model or external API
const classifyImage = (imagePath) => {
    try {
        const cmd = `python classify_image.py ${imagePath}`;
        const result = execSync(cmd, { encoding: 'utf8' });  // Specify encoding
        return result.toString().trim();
    } catch (error) {
        console.error('Error classifying image:', error);
        return 'Classification failed';
    }
};

// Endpoint for uploading and processing images
app.post('/process-images', upload.array('images'), async (req, res) => {
    const files = req.files;

    try {
        const { width = null, height = null, sourceFormat = null, targetFormat = null, quality = 90, removeBg = false, compress = 9, classify = false } = req.body;

        const validSize = validateImageSize(width, height);
        if (!validSize) {
            return res.status(400).json({ error: 'Invalid image dimensions' });
        }
        const filesOutput = fs.readdirSync(outputFolder);
        filesOutput.forEach(file => {
            const filePath = path.join(outputFolder, file);
            try {
                fs.unlinkSync(filePath);
                console.log(`File ${filePath} deleted successfully`);
            } catch (err) {
                console.error(`Error deleting file ${filePath}: ${err.message}`);
            }
        });

        const processedImages = await Promise.all(files.map(async (file) => {
            const imageBuffer = file.buffer;
            let processedImageBuffer = sharp(imageBuffer);

            let determinedSourceFormat = sourceFormat;
            if (!determinedSourceFormat && file.originalname) {
                determinedSourceFormat = getFileExtension(file.originalname);
            }

            if (width && height) {
                processedImageBuffer = processedImageBuffer.resize({
                    width: parseInt(width, 10),
                    height: parseInt(height, 10),
                    fit: 'fill',
                    position: 'center',
                });
            } else if (width) {
                processedImageBuffer = processedImageBuffer.resize({
                    width: parseInt(width, 10),
                    fit: 'inside',
                });
            } else if (height) {
                processedImageBuffer = processedImageBuffer.resize({
                    height: parseInt(height, 10),
                    fit: 'inside',
                });
            }

            if (determinedSourceFormat && targetFormat) {
                processedImageBuffer = processedImageBuffer.toFormat(targetFormat, {
                    quality: quality ? parseInt(quality, 10) : 90,
                    compressionLevel: compress ? parseInt(compress, 10) : 9 // Added compression setting
                });
            }

            const resultBuffer = await processedImageBuffer.toBuffer();
            const fileName = file.originalname.replace(determinedSourceFormat.toLowerCase(), targetFormat.toLowerCase());
            let processedImagePath = path.join(outputFolder, `${Date.now()}-${fileName}`);
            fs.writeFileSync(processedImagePath, resultBuffer);

            if (removeBg) {
                const outputPath = processedImagePath.replace(path.extname(processedImagePath), '_nobg.png');
                const removeBgCmd = `python background_removal.py ${processedImagePath} ${outputPath}`;
                try {
                    execSync(removeBgCmd);
                    processedImagePath = outputPath;  // Update path to the new processed image
                } catch (error) {
                    console.error(`Error removing background: ${error.message}`);
                    return { error: 'Background removal failed' };
                }
            }

            let classificationResult = null;
            if (classify) {
                classificationResult = await classifyImage(processedImagePath);
            }

            const resultBase64 = await sharp(processedImagePath).toBuffer().then(buffer => buffer.toString('base64'));
            const originalBase64 = await sharp(imageBuffer).toBuffer().then(buffer => buffer.toString('base64'));

            return {
                base64: resultBase64,
                originalBase64: originalBase64,
                originalFormat: determinedSourceFormat,
                targetFormat: targetFormat || determinedSourceFormat,
                classification: classificationResult,
                originalName: file.originalName,
            };
        }));

        res.status(200).json(processedImages);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not process the images' });
    }
});

// Endpoint for downloading the entire 'output' folder as a zip file
app.get('/download-images', async (req, res) => {
    try {
        const outputFolder = path.join(__dirname, 'output');

        if (!fs.existsSync(outputFolder)) {
            return res.status(404).json({ error: 'Output folder not found' });
        }

        const zipFileName = 'processed_images.zip';
        const zipFilePath = path.join(__dirname, zipFileName);
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', {
            zlib: { level: 9 },
        });

        output.on('close', () => {
            console.log(`${archive.pointer()} total bytes`);
            console.log('archiver has been finalized and the output file descriptor has closed.');

            res.download(zipFilePath, zipFileName, (err) => {
                if (err) {
                    console.error('Error downloading zip file:', err);
                    res.status(500).json({ error: 'Could not download the zip file' });
                } else {
                    fs.unlinkSync(zipFilePath);
                }
            });
        });

        archive.on('error', (err) => {
            throw err;
        });

        archive.pipe(output);

        archive.directory(outputFolder, false);

        archive.finalize();

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not download the zip file' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
