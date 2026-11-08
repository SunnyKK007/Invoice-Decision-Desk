// Vercel runs files in api/ as serverless functions. This one serves /api/read,
// the built-in Gemini reader. The code lives in src/api/read.js.
module.exports = require("../src/api/read.js");
