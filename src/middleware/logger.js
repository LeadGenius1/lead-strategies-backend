// Request Logger Middleware

const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  // Log request
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);

  // Log response on finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusColor = res.statusCode >= 400 ? '\x1b[31m' : '\x1b[32m';
    console.log(`[${timestamp}] ${req.method} ${req.path} ${statusColor}${res.statusCode}\x1b[0m ${duration}ms`);
  });

  next();
};

module.exports = { requestLogger };

