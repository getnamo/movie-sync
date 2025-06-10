const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const socketIO = require('socket.io');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
	fs.mkdirSync(uploadDir);
}

// Track uploaded videos and currently active video
let uploadedFiles = fs.readdirSync(uploadDir).filter(f => f.endsWith('.mp4'));
let currentFilename = uploadedFiles[0] || null;

// Multer config to save files with original name
const storage = multer.diskStorage({
	destination: (req, file, cb) => cb(null, uploadDir),
	filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));
app.use(express.json());

// Endpoint: Get current video
app.get('/current-video', (req, res) => {
	res.json({ filename: currentFilename });
});

// Endpoint: Get video list
app.get('/video-list', (req, res) => {
	res.json({ videos: uploadedFiles });
});

// Endpoint: Set active video
app.post('/set-video', (req, res) => {
	const { filename } = req.body;
	if (!uploadedFiles.includes(filename)) return res.sendStatus(404);

	currentFilename = filename;
	io.emit('videoChanged', currentFilename);
	res.sendStatus(200);
});

// Endpoint: Stream currently selected video
app.get('/movie.mp4', (req, res) => {
	if (!currentFilename) return res.sendStatus(404);
	const filePath = path.join(uploadDir, currentFilename);
	res.sendFile(filePath);
});

// Endpoint: Upload new video
app.post('/upload', upload.single('video'), (req, res) => {
	const uploadedName = req.file.originalname;

	if (!uploadedFiles.includes(uploadedName)) {
		uploadedFiles.push(uploadedName);
	}
	currentFilename = uploadedName;

	console.log('Video uploaded:', uploadedName);

	io.emit('videoChanged', uploadedName);
	io.emit('videoListChanged', uploadedFiles);

	res.sendStatus(200);
});

// Playback sync logic
let currentState = {
	paused: true,
	currentTime: 0,
	lastUpdate: Date.now()
};

const resyncThreshold = 0.75

let clients = {};

function serverPlaybackSyncTime(){
	if(currentState.paused){
		return currentState.currentTime;
	}

	const playedTime = (Date.now() - currentState.lastUpdate)/1000;
	return currentState.currentTime + playedTime;
}

io.on('connection', (socket) => {
	const clientId = socket.id.slice(0,4);
	const clientIp =
		socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || // behind proxy
		socket.handshake.address; // direct connection fallback

	clients[clientId] = socket;

	console.log(`${clientId} <${clientIp}> client connected (${Object.keys(clients).length})`);

	socket.emit('clientId', clientId);

	// Send current playback state
	socket.emit('syncState', currentState);

	socket.on('disconnect', ()=>{
		delete clients[clientId];
		console.log(`${clientId} <${clientIp}> client disconnected (${Object.keys(clients).length})`);
	});

	socket.on('play', (time) => {
		console.log(`received play from ${clientId}`);
		currentState = {
			paused: false,
			currentTime: time,
			lastUpdate: Date.now()
		};
		socket.broadcast.emit('play', time);
	});

	socket.on('pause', (time) => {
		console.log(`received pause from ${clientId}`);
		currentState = {
			paused: true,
			currentTime: time,
			lastUpdate: Date.now()
		};
		socket.broadcast.emit('pause', time);
	});

	socket.on('seek', (time) => {
		console.log(`received seek from ${clientId}`);
		currentState.currentTime = time;
		currentState.lastUpdate = Date.now();
		socket.broadcast.emit('seek', time);
	});

	//server time (might not be necessary)
	socket.on('requestSyncTime', ()=>{
		return serverPlaybackSyncTime();
	});

	socket.on('requestSync', () => {
		socket.emit('syncState', currentState);
	});
});

let syncData = {};

// Endpoint: get current playback time for every client
app.get('/syncCheck', (req, res) => {
	//clear last sync data
	syncData = {}

	console.log('obtaining sync data');

	Object.keys(clients).forEach(key=>{
		const socket = clients[key];

		console.log('emit requestSyncData for ', key);

		const then = Date.now();

		//emit to socket
		socket.emit('requestSyncData', data=>{
			const now = Date.now();

			const clientSyncData = {
				time: data.currentTime,
				latency: now-then,
				offset: data.currentTime - serverPlaybackSyncTime()
			}

			syncData[key] = clientSyncData;

			console.log('callback requestSyncData for ', key, data);

			//re-sync
			if(Math.abs(clientSyncData.offset)> resyncThreshold && !currentState.paused){
				console.log('resyncing client ', key);
				socket.emit('forceSync', {serverTime: serverPlaybackSyncTime()});
			}
			

			//When we've obtained all, respond with full json
			if(Object.keys(syncData).length == Object.keys(clients).length){
				res.json(syncData);
			}
		});
	})
});

// Start server
server.listen(3000, () => {
	console.log('Server running on http://localhost:3000');
});
