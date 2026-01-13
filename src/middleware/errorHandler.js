// Error Handler Middleware

const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: 'Conflict',
      message: 'A record with this value already exists.',
      field: err.meta?.target?.[0] || 'unknown'
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      error: 'Not Found',
      message: 'The requested record was not found.'
    });
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: err.message,
      details: err.details || []
    });
  }

  // JWT errors (handled in auth middleware but just in case)
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token.'
    });
  }

  // Multer file upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: 'File Too Large',
      message: 'The uploaded file exceeds the size limit.'
    });
  }

  // Default error
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'An unexpected error occurred'
    : err.message;

  res.status(statusCode).json({
    error: err.name || 'Internal Server Error',
    message: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
};

module.exports = { errorHandler };

