const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// MongoDB Connection
mongoose.connect('mongodb+srv://<username>:<password>@cluster.mongodb.net/streamingDB', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const db = mongoose.connection;
db.once('open', () => console.log('Connected to MongoDB'));

// MongoDB Schemas
const UserSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
});
const VideoSchema = new mongoose.Schema({
  title: String,
  description: String,
  userId: mongoose.Schema.Types.ObjectId,
  videoPath: String,
  hlsPath: String,
  uploadDate: { type: Date, default: Date.now },
});
const User = mongoose.model('User', UserSchema);
const Video = mongoose.model('Video', VideoSchema);

// Multer Configuration for File Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = './uploads/';
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// JWT Authentication Middleware
const authenticateJWT = (req, res, next) => {
  const token = req.header('Authorization');
  if (!token) return res.status(401).json({ message: 'Access Denied' });
  try {
    req.user = jwt.verify(token, 'secret_key');
    next();
  } catch (error) {
    res.status(400).json({ message: 'Invalid Token' });
  }
};

// Routes
// 1. User Registration
app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = new User({ username, email, password: hashedPassword });
  await user.save();
  res.json({ message: 'User registered successfully' });
});

// 2. User Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ message: 'Invalid credentials' });

  const token = jwt.sign({ id: user._id }, 'secret_key', { expiresIn: '1h' });
  res.json({ token });
});

// 3. Upload Video
app.post('/upload', authenticateJWT, upload.single('video'), async (req, res) => {
  const { title, description } = req.body;
  const videoPath = req.file.path;

  // Process video using FFmpeg to create HLS
  const hlsPath = `./hls/${Date.now()}`;
  if (!fs.existsSync(hlsPath)) fs.mkdirSync(hlsPath, { recursive: true });

  ffmpeg(videoPath)
    .output(`${hlsPath}/output.m3u8`)
    .outputOptions([
      '-codec: copy',
      '-start_number 0',
      '-hls_time 10',
      '-hls_list_size 0',
      '-f hls',
    ])
    .on('end', async () => {
      const video = new Video({
        title,
        description,
        userId: req.user.id,
        videoPath,
        hlsPath,
      });
      await video.save();
      res.json({ message: 'Video uploaded and processed successfully', video });
    })
    .on('error', (err) => {
      res.status(500).json({ message: 'Error processing video', error: err.message });
    })
    .run();
});

// 4. Fetch Videos
app.get('/videos', async (req, res) => {
  const videos = await Video.find().populate('userId', 'username email');
  res.json(videos);
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
