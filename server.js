const express = require('express');
const http = require('http');
const path = require('path');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const multer = require('multer');

app.use(express.static(path.join(__dirname, 'public')));

// Store uploads in 'uploads/' and overwrite 'movie.mp4'
const storage = multer.diskStorage({
	destination: (req, file, cb) => cb(null, './uploads'),
	filename: (req, file, cb) => cb(null, 'movie.mp4')
});
const upload = multer({ storage });

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Replace video
app.post('/upload', upload.single('video'), (req, res) => {
	console.log('Video uploaded:', req.file);
	io.emit('videoChanged');
	res.sendStatus(200);
});

// Serve video dynamically
app.get('/movie.mp4', (req, res) => {
	const filePath = path.join(__dirname, 'uploads/movie.mp4');
	res.sendFile(filePath);
});

let currentState = {
	paused: true,
	currentTime: 0,
	lastUpdate: Date.now()
};

io.on('connection', (socket) => {
	console.log('New client connected');

	// Send current state to new client
	socket.emit('syncState', currentState);

	socket.on('play', (time) => {
		currentState = {
			paused: false,
			currentTime: time,
			lastUpdate: Date.now()
		};
		socket.broadcast.emit('play', time);
	});

	socket.on('pause', (time) => {
		currentState = {
			paused: true,
			currentTime: time,
			lastUpdate: Date.now()
		};
		socket.broadcast.emit('pause', time);
	});

	socket.on('seek', (time) => {
		currentState.currentTime = time;
		currentState.lastUpdate = Date.now();
		socket.broadcast.emit('seek', time);
	});
});

server.listen(3000, () => {
	console.log('Server running on http://localhost:3000');
});
