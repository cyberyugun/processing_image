const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { execSync } = require('child_process');
const { createCanvas, loadImage } = require('canvas');

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
        const { 
            width = null, 
            height = null, 
            sourceFormat = null, 
            targetFormat = null, 
            quality = 90, 
            removeBg = false, 
            compress = 9, 
            classify = false,
            brightness = null,
            contrast = null,
            saturation = null,
            sharpness = null,
            colorBalance = null,
            noiseReduction = null,
            whiteBalance = null,
            vignetteCorrection = null,
            panorama = false,
            horizontalPanorama = false,
        } = req.body;

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

        if (panorama) {
            let panoramaBuffer;
            if (horizontalPanorama) {
                panoramaBuffer = await createHorizontalPanorama(files);
            } else {
                panoramaBuffer = await createPanorama(files);
            }
            const resultImageBuffer = sharp(panoramaBuffer);

            // Example of saving the panorama result to output folder
            const resultFileName = `panorama-${Date.now()}.png`;
            const resultImagePath = path.join(outputFolder, resultFileName);
            await resultImageBuffer.toFile(resultImagePath);

            const resultBase64 = await sharp(resultImagePath).toBuffer().then(buffer => buffer.toString('base64'));
            // const originalBase64 = await sharp(files.map(async (file) => file.buffer)).toBuffer().then(buffer => buffer.toString('base64'));
            const jsonData = {
                base64: resultBase64,
                originalBase64: '',
                originalFormat: '',
                targetFormat: targetFormat || 'png',
                classification: '',
                originalName: '',
            };
            res.status(200).json([jsonData]);
        } else {
            const processedImages = await Promise.all(files.map(async (file) => {
                const imageBuffer = file.buffer;
                let processedImageBuffer = sharp(imageBuffer);
    
                let determinedSourceFormat = sourceFormat;
                if (!determinedSourceFormat && file.originalname) {
                    determinedSourceFormat = getFileExtension(file.originalname);
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
    
                let resultImageBuffer = sharp(imageToBuffer(processedImagePath));
    
                if (width && height) {
                    resultImageBuffer = resultImageBuffer.resize({
                        width: parseInt(width, 10),
                        height: parseInt(height, 10),
                        fit: 'fill',
                        position: 'center',
                    });
                } else if (width) {
                    resultImageBuffer = resultImageBuffer.resize({
                        width: parseInt(width, 10),
                        fit: 'inside',
                    });
                } else if (height) {
                    resultImageBuffer = resultImageBuffer.resize({
                        height: parseInt(height, 10),
                        fit: 'inside',
                    });
                }
                // Apply image enhancement operations
                if (brightness || contrast || saturation) {
                    resultImageBuffer = resultImageBuffer.modulate({
                        brightness: brightness ? parseFloat(brightness) : 1,
                        contrast: contrast ? parseFloat(contrast) : 1,
                        saturation: saturation ? parseFloat(saturation) : 1,
                    });
                }
    
                if (sharpness) {
                    resultImageBuffer = resultImageBuffer.sharpen(parseFloat(sharpness));
                }
    
                if (colorBalance) {
                    resultImageBuffer = resultImageBuffer.toColorspace('srgb').modulate({
                        saturation: parseFloat(colorBalance),
                    });
                }
    
                // Apply noise reduction
                if (noiseReduction) {
                    resultImageBuffer = resultImageBuffer.blur(parseFloat(noiseReduction));
                }
    
                // Apply white balance adjustment
                // if (whiteBalance) {
                //     resultImageBuffer = await applyWhiteBalance(resultImageBuffer, parseFloat(whiteBalance), targetFormat.toLowerCase()).then(resultBuffer => {
                //         // Use the adjusted image buffer as needed
                //         console.log('White balance applied successfully');
                //     })
                //     .catch(error => {
                //         console.error('Error applying white balance:', error);
                //     });;
                // }
    
                // Apply vignette correction
                // if (vignetteCorrection) {
                //     resultImageBuffer = await applyVignette(resultImageBuffer, parseFloat(vignetteCorrection));
                // }
    
                // Handle panorama creation if requested
                const resBuf = await resultImageBuffer.toBuffer();
                let resultImagePath = path.join(outputFolder, `final-${Date.now()}-${fileName}`);
                fs.writeFileSync(resultImagePath, resBuf);
    
                const resultBase64 = await sharp(resultImagePath).toBuffer().then(buffer => buffer.toString('base64'));
                const originalBase64 = await sharp(imageBuffer).toBuffer().then(buffer => buffer.toString('base64'));
                fs.unlinkSync(processedImagePath);
    
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
        }
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
        const filesOutput = fs.readdirSync(outputFolder);
        filesOutput.forEach(file => {
            if (!file.includes('final')) {
                const filePath = path.join(outputFolder, file);
                try {
                    fs.unlinkSync(filePath);
                    console.log(`File ${filePath} deleted successfully`);
                } catch (err) {
                    console.error(`Error deleting file ${filePath}: ${err.message}`);
                }
            }
        });

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

// Example function to read image file into a buffer
function imageToBuffer(filePath) {
    try {
        // Synchronously read the file contents into a buffer
        const imageBuffer = fs.readFileSync(filePath);
        return imageBuffer;
    } catch (err) {
        console.error('Error reading file:', err);
        return null;
    }
}
// Example function to apply white balance adjustment
async function applyWhiteBalance(imageBuffer, whiteBalance, targetFormat) {
    try {
        // Load image buffer using Sharp
        const image = sharp(imageBuffer);

        // Get image metadata (width, height, channels)
        const metadata = await image.metadata();
        const { width, height, channels } = metadata;

        // Convert image to raw pixel data (RGBA)
        const { data } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

        // Apply white balance to RGB channels (skip alpha channel if present)
        for (let i = 0; i < data.length; i += channels) {
            data[i] = Math.min(data[i] * whiteBalance, 255);         // Red channel
            data[i + 1] = Math.min(data[i + 1] * whiteBalance, 255); // Green channel
            data[i + 2] = Math.min(data[i + 2] * whiteBalance, 255); // Blue channel
            // Skip alpha channel (if present) - RGBA format
            if (channels === 4) {
                data[i + 3] = data[i + 3]; // Alpha channel
            }
        }

        // Create a new Sharp instance with modified raw pixel data
        const adjustedImage = sharp(data, {
            raw: {
                width,
                height,
                channels,
            },
        });

        // Convert adjusted image back to desired format (JPEG, PNG, etc.)
        const resultBuffer = await adjustedImage.toFormat(targetFormat).toBuffer();

        return resultBuffer;
    } catch (error) {
        console.error('Error applying white balance:', error);
        throw error;
    }
}

// Function to apply vignette effect manually
function applyVignette(imageBuffer, amount = 0.5, sigma = 0.8, targetFormat) {
    const image = sharp(imageBuffer);

    return image.metadata()
        .then(metadata => {
            const { width, height } = metadata;
            const vignetteCanvas = Buffer.alloc(width * height * 4);

            for (let x = 0; x < width; x++) {
                for (let y = 0; y < height; y++) {
                    const idx = (y * width + x) * 4;
                    const distance = Math.sqrt(Math.pow((x - width / 2), 2) + Math.pow((y - height / 2), 2));
                    const vignette = 1 - (distance / (Math.sqrt(Math.pow(width / 2, 2) + Math.pow(height / 2, 2)))) * amount;

                    vignetteCanvas[idx] = Math.round(imageBuffer[idx] * vignette);
                    vignetteCanvas[idx + 1] = Math.round(imageBuffer[idx + 1] * vignette);
                    vignetteCanvas[idx + 2] = Math.round(imageBuffer[idx + 2] * vignette);
                    vignetteCanvas[idx + 3] = imageBuffer[idx + 3];
                }
            }

            return sharp(vignetteCanvas, { raw: { width, height, channels: 4 } })
                .toFormat(targetFormat)  // Adjust format as needed
                .toBuffer();
        });
}

// Function to stitch multiple images into a panorama
async function createPanorama(images) {
    try {
        // Load all images and determine dimensions
        const loadedImages = await Promise.all(images.map(image => loadImage(image.buffer)));

        // Determine maximum width and total height of stitched image
        const maxWidth = Math.max(...loadedImages.map(img => img.width));
        const totalHeight = loadedImages.reduce((acc, img) => acc + img.height, 0);

        // Create a canvas to stitch images onto
        const canvas = createCanvas(maxWidth, totalHeight);
        const ctx = canvas.getContext('2d');
        let offsetY = 0;

        // Draw each image onto the canvas
        for (const img of loadedImages) {
            ctx.drawImage(img, 0, offsetY);
            offsetY += img.height;
        }

        // Convert canvas to buffer and return
        return canvas.toBuffer();
    } catch (error) {
        console.error('Error creating panorama:', error);
        throw error;
    }
}

// Function to stitch multiple images into a horizontal panorama
async function createHorizontalPanorama(images) {
    try {
        // Load all images and determine dimensions
        const loadedImages = await Promise.all(images.map(image => loadImage(image.buffer)));
        
        // Calculate total width and maximum height
        const totalWidth = loadedImages.reduce((acc, img) => acc + img.width, 0);
        const maxHeight = Math.max(...loadedImages.map(img => img.height));

        // Create a canvas to stitch images onto
        const canvas = createCanvas(totalWidth, maxHeight);
        const ctx = canvas.getContext('2d');
        let offsetX = 0;

        // Draw each image onto the canvas horizontally
        for (const img of loadedImages) {
            ctx.drawImage(img, offsetX, 0);
            offsetX += img.width;
        }

        // Convert canvas to buffer and return
        return canvas.toBuffer();
    } catch (error) {
        console.error('Error creating horizontal panorama:', error);
        throw error;
    }
}

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
