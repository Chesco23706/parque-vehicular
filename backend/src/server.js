import { config } from './config.js';
import app from './app.js';

app.listen(config.port, () => {
  console.log(`API Parque Vehicular en http://127.0.0.1:${config.port}`);
});
