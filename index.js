const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

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
    // Define maximum dimensions for safety (adjust as necessary)
    const MAX_WIDTH = 5000;
    const MAX_HEIGHT = 5000;

    // Validate width and height
    if (width && (parseInt(width, 10) <= 0 || parseInt(width, 10) > MAX_WIDTH)) {
        return false; // Invalid width
    }
    if (height && (parseInt(height, 10) <= 0 || parseInt(height, 10) > MAX_HEIGHT)) {
        return false; // Invalid height
    }
    return true; // Valid dimensions
};

// Function to get file extension from mimetype
const getFileExtension = (originalName) => {
    const ext = path.extname(originalName);
    return ext.replace('.', '')
};

// Endpoint for uploading and processing images
app.post('/process-images', upload.array('images'), async (req, res) => {
    // Handle file upload using Multer
    const files = req.files;

    try {
        // Extract parameters from the request body
        const { width = null, height = null, sourceFormat = null, targetFormat = null, quality = 90 } = req.body;

        // Validate Image Size
        const validSize = validateImageSize(width, height);
        if (!validSize) {
            return res.status(400).json({ error: 'Invalid image dimensions' });
        }
        const filesOutput = fs.readdirSync(outputFolder);
        filesOutput.forEach(file => {
            const filePath = path.join(outputFolder, file);
            fs.unlinkSync(filePath);
        });

        // Process each image
        const processedImages = await Promise.all(files.map(async (file) => {
            const imageBuffer = file.buffer;
            let processedImageBuffer = sharp(imageBuffer);

            // Determine source format if not explicitly provided
            let determinedSourceFormat = sourceFormat;
            if (!determinedSourceFormat && file.originalname) {
                determinedSourceFormat = getFileExtension(file.originalname);
            }

            // Resize image based on provided dimensions or auto-fit if only one dimension is provided
            if (width && height) {
                processedImageBuffer = processedImageBuffer.resize({
                    width: parseInt(width, 10),
                    height: parseInt(height, 10),
                    fit: 'fill', // Ensures the entire area of the image is filled
                    position: 'center', // Centers the resized image
                });
            } else if (width) {
                processedImageBuffer = processedImageBuffer.resize({
                    width: parseInt(width, 10),
                    fit: 'inside', // Keeps the entire image within the specified width
                });
            } else if (height) {
                processedImageBuffer = processedImageBuffer.resize({
                    height: parseInt(height, 10),
                    fit: 'inside', // Keeps the entire image within the specified height
                });
            }

            // Convert image format if source and target formats are provided
            if (determinedSourceFormat && targetFormat) {
                processedImageBuffer = processedImageBuffer.toFormat(targetFormat, { quality: quality ? parseInt(quality, 10) : 90 });
            }

            // Generate the processed image
            const resultBuffer = await processedImageBuffer.toBuffer();
            const fileName = file.originalname.replace(determinedSourceFormat.toLowerCase(), targetFormat.toLowerCase())
            // Save the processed image to the output directory with a unique filename
            const processedImagePath = path.join(outputFolder, `${Date.now()}-${fileName}`);
            fs.writeFileSync(processedImagePath, resultBuffer);

            const resultBase64 = await processedImageBuffer.toBuffer().then(buffer => buffer.toString('base64'));

            // Return object with processed image path (optional)
            return {
                base64: resultBase64,
                originalName: file.originalName, // Adjust as needed
            };
        }));

        // Send response with processed images (optional)
        res.status(200).json(processedImages);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not process the images' });
    }
});

// Endpoint for downloading the entire 'output' folder as a zip file
app.get('/download-images', async (req, res) => {
    try {
        // Define the path to the 'output' folder
        const outputFolder = path.join(__dirname, 'output');

        // Check if the 'output' folder exists
        if (!fs.existsSync(outputFolder)) {
            return res.status(404).json({ error: 'Output folder not found' });
        }

        // Create a zip file with the 'output' folder contents
        const zipFileName = 'processed_images.zip';
        const zipFilePath = path.join(__dirname, zipFileName);
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', {
            zlib: { level: 9 }, // Sets the compression level
        });

        output.on('close', () => {
            console.log(`${archive.pointer()} total bytes`);
            console.log('archiver has been finalized and the output file descriptor has closed.');

            // Send the zip file as a download response
            res.download(zipFilePath, zipFileName, (err) => {
                if (err) {
                    console.error('Error downloading zip file:', err);
                    res.status(500).json({ error: 'Could not download the zip file' });
                } else {
                    // Clean up: Delete the zip file after download
                    fs.unlinkSync(zipFilePath);
                }
            });
        });

        archive.on('error', (err) => {
            throw err;
        });

        // Pipe archive data to the output file
        archive.pipe(output);

        // Add the entire 'output' folder contents to the zip file
        archive.directory(outputFolder, false);

        // Finalize the archive (this will create the zip file)
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
