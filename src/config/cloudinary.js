const cloudinary = require('cloudinary').v2;
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Configure Cloudinary: supports both single CLOUDINARY_URL or discrete credentials
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({
    cloudinary_url: process.env.CLOUDINARY_URL,
    secure: true
  });
} else if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

function isCloudinaryConfigured() {
  const config = cloudinary.config();
  return !!(process.env.CLOUDINARY_URL || (config.cloud_name && config.api_key && config.api_secret));
}

module.exports = {
  cloudinary,
  isCloudinaryConfigured
};
