import app from './app.js';

const PORT = process.env.PORT || 5174;

// Single entrypoint to start the server. All middleware, routes, DB setup, and background jobs
// are defined in server/app.js to avoid duplication and undefined references.
app.listen(PORT, () => {
  console.log(`Ganudenu backend running at http://localhost:${PORT}`);
});