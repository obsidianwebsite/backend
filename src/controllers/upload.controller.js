const { cloudinary, isCloudinaryConfigured } = require('../config/cloudinary');

/**
 * Upload identity verification image / passport / KYC document to Cloudinary
 * POST /api/v1/upload/kyc
 */
async function uploadKycImage(req, res) {
  try {
    const { image, folder } = req.body;

    if (!image) {
      return res.status(400).json({
        success: false,
        message: 'No image data provided for upload.'
      });
    }

    if (isCloudinaryConfigured()) {
      console.log('☁️ [Cloudinary] Uploading KYC document to Cloudinary CDN...');
      const uploadResult = await cloudinary.uploader.upload(image, {
        folder: folder || 'otb_kyc_verifications',
        resource_type: 'image',
        transformation: [
          { width: 1200, height: 1200, crop: 'limit' },
          { quality: 'auto', fetch_format: 'auto' }
        ]
      });

      console.log('✅ [Cloudinary] Upload successful! Secure URL:', uploadResult.secure_url);

      return res.status(200).json({
        success: true,
        message: 'KYC identity document uploaded successfully to Cloudinary.',
        url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
        format: uploadResult.format,
        provider: 'cloudinary'
      });
    } else {
      console.warn('⚠️ [Cloudinary] CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME is not configured in backend environment variables. Falling back to direct safe image storage.');
      
      return res.status(200).json({
        success: true,
        message: 'Image received successfully (Cloudinary credentials pending in backend environment).',
        url: image,
        provider: 'fallback'
      });
    }
  } catch (err) {
    console.error('❌ [Cloudinary Upload Error]:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to upload image to Cloudinary.'
    });
  }
}

module.exports = {
  uploadKycImage
};
