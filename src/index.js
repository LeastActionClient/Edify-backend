import app, { dbReady } from './app.js';

const PORT = process.env.PORT || 5000;

dbReady.then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
