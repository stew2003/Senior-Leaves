var express = require('express');
var anyDB = require('any-db');
var bodyParser = require("body-parser");
var conn = anyDB.createConnection('sqlite3://Senior-Leaves.db');
var app = express();
var mustache = require('mustache-express');
var moment = require('moment');
var server = require('http').createServer(app);
var io = require('socket.io')(server);

app.engine('html', mustache());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static('views'));

conn.query("CREATE TABLE IF NOT EXISTS leave_records (uid INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, sign_out SMALLDATETIME, sign_in SMALLDATETIME);");
conn.query("CREATE TABLE IF NOT EXISTS student_info (uid INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, password TEXT, username TEXT, ban_until SMALLDATETIME);");
conn.query("CREATE TABLE IF NOT EXISTS login (uid INTEGER PRIMARY KEY AUTOINCREMENT, password TEXT);");
conn.query("CREATE TABLE IF NOT EXISTS numLeaves (uid INTEGER PRIMARY KEY AUTOINCREMENT, leaves INTEGER);");

// CLEAR DB
conn.query('DELETE FROM leave_records;');
conn.query('DELETE FROM student_info;');
conn.query('DELETE FROM numLeaves;');
conn.query('DELETE FROM login;');

// set number of leaves = 3
conn.query('INSERT INTO numLeaves (leaves) VALUES (3);', function(err, res) { if (err) throw err; });
// set admin password = "admin"
conn.query('INSERT INTO login (password) VALUES ("admin");');

// sign out for a leave under a specific name
function signout(name, socket) {
	// get ban info
	getStudentInfo(name, function(result){
		if (result.rows.length > 0) {
			var student = result.rows[0];

			// if user banned
			if (checkBanned(student.ban_until)) {
				socket.emit('banned');
			} 
			else {
				// if not banned but ban date exists, make null
				if (student.ban_until != null) {
					conn.query('UPDATE student_info SET ban_until = NULL WHERE name = ?;', [name], function(err, result) {
						if (err) throw err;
					});
				}
				checkLeaveAvailable(name, function(available) {
					// if student has leave available
					if (available) {
						// add new leave record
						conn.query('INSERT INTO leave_records (name, sign_out) VALUES (?, ?);', [name, moment().format('YYYY-MM-DD HH:mm:ss')], function(err, result) {
							if (err) throw err;
						});
					}

					// broadcast to listeners
					socket.broadcast.emit('new sign out', {
						name: name,
						signout_time: moment().format('h:mm:ss A M/D/YYYY')
					});
					socket.emit('refresh');
				});
			}
		}
	});
}

// sign in for a leave under a specific name
function signin(name, socket) {
	// get the most recent leave record under this name
	conn.query('SELECT * FROM leave_records WHERE name = ? ORDER BY uid DESC LIMIT 1;', [name], function(err, result) {
		if (err) throw err;
		if (result.rows.length > 0) {
			var last = result.rows[0];
			// if not already signed in
			if (last.sign_in == null) {
				// update to reflect sign in
				conn.query('UPDATE leave_records SET sign_in = ? WHERE uid = ?;', [moment().format('YYYY-MM-DD HH:mm:ss'), last.uid], function(err, result) {
					if (err) throw err;

					// broadcast to listeners
					socket.broadcast.emit('new sign in', {
						name: name,
						signin_time: moment().format('h:mm:ss A M/D/YYYY')
					});
					socket.emit('refresh');
				});
			}
		}
	});
}
//get date that a student is banned until
function getStudentInfo(name, callback){
	conn.query('SELECT * FROM student_info WHERE name = ? LIMIT 1;', [name], function(err, result){
		if (err) throw err;
		callback(result);
	});
}

//check if ban_until date has been reached
function checkBanned(ban_until) {
	return ban_until != null && moment().isBefore(moment(ban_until));
}

//check if a non-banned student has leaves this week (true false)
function checkLeaveAvailable(name, callback) {
	getCurrentLeaveLimit(function(leaveLimit) {
		getLeavesFromThisWeek(name, function(rows) {
			callback(rows.length < leaveLimit);
		});
	});
}

// get the current amount of leaves for this week (probably db call)
function getCurrentLeaveLimit(callback) {
	conn.query("SELECT * FROM numLeaves", function(err,data){
		if (err) throw err;
		var leave_limit = data.rows[0].leaves;
		callback(leave_limit);
	});
}

// get the records of leaves of a student this week
function getLeavesFromThisWeek(name, callback) {
	conn.query('SELECT * FROM leave_records WHERE name = ? AND sign_out > ?;', [name, moment().startOf('week').format("YYYY-MM-DD HH:mm:ss")], function(err, result) {
		if (err) throw err;
		callback(result.rows);
	});
}

//get how many leaves a student has left this week
function getLeavesLeft(name, callback){
	getCurrentLeaveLimit(function(leave_limit){
		getLeavesFromThisWeek(name, function(leaves_taken){
			callback(leave_limit - leaves_taken.length);
		});
	});
}

//render the student pg
function renderStudPg(response, name, username){
	var student = {};
	student.name = name;
	student.username = username;
	getStudentInfo(name, function(banDate){
		if (banDate.rows.length == 0){ //if user does not exist, render the thome page with an error message
			student.error = true;
			response.render('homepage.html', student);
		}
		else{ //user does exist, so keep going
			banDate = banDate.rows[0].ban_until
			getLeavesFromThisWeek(name, function(leaves_taken){
				if (leaves_taken.length == 0) { //if this user has not taken any leves yet
					student.last_leave = "No leaves have been taken yet!"
				}
				else{ //else this user has taken a leave, and so set the last_leave property equal to the date of the last time he/she signed out.
					student.last_leave = leaves_taken[leaves_taken.length - 1].sign_out;
				}

				if(checkBanned(banDate) == true){ //if user is banned, don't show a button, just show banned until + the date
					student.message = "Banned until:" + banDate;
					student.num_leaves = "Banned";
					student.title = "Banned";
					response.render('student.html', student);
				}
				else{ //if user isn't banned
					getLeavesLeft(name, function(leaves_left){
						student.num_leaves = leaves_left;
						if (leaves_taken.length == 0){ //user has never taken a leave before
							student.sign_out = true;
							student.title = "Sign Out"
						}
						else if(leaves_taken[leaves_taken.length -1].sign_in == null){ //if the user has not signed back in
							student.sign_in = true;
							student.title = "Sign In";
						}
						else if (leaves_left == 0){ //if the user has no leaves left this week
							student.message = "Wait until next week";
							student.title = "Wait"
						}
						else if (moment(student.last_leave).isSame(moment(), 'day')){ //if they have taken a leave already today
							student.message = "Wait until tomorrow";
							student.title = "Wait"
						}
						else{
							student.sign_out = true;
							student.title = "Sign Out"
						}
						response.render('student.html', student);
					});
				}
			});
		}
	});
}

// check admin password and render page if legitimate
function authenticateAdmin(response, userPassword){
	conn.query("SELECT * FROM login", function(err, data){
		if (err) throw err;
		if (data.rows.length > 0) {
			if (data.rows[0].password == userPassword){
				renderAdminPage(response);
			}
			else{
				response.redirect('/login');
			}
		}
	});
}

// initialize a new student account in db
function createNewAccount(request, response){
	var name = request.body.name;
	var username = request.body.username;
	var password = request.body.password;
	var confirmPassword = request.body.confirmPassword;
	var errorObj = {};
	getStudentInfo(name, function(student){
		if (student.rows.length == 0){
			errorObj.errorMessage = "User " + name + " is not in the database. Please contact a creator of this page, if there is a mistake."
			errorObj.nameError = true;
			response.render('newAccount.html', errorObj);
		}
		else if (password != confirmPassword){
			errorObj.errorMessage = "The passwords do not match.";
			errorObj.passwordError = true;
			response.render('newAccount.html', errorObj);
		}
		else if (name == "" || username == "" || password == ""|| confirmPassword == ""){
			errorObj.errorMessage = "Please fill out all required fields.";
			errorObj.emptyError = true;
			response.render('newAccount.html', errorObj);
		}
		else{
			conn.query("UPDATE student_info SET username = ?, password = ? WHERE name = ?", [username, password, name], function(err, data){ if (err) throw err; });
			response.redirect('/');
		}
	});
}

// check student password
function authenticateStudent(request, response){
	username = request.body.username;
	password = request.body.password;
	conn.query('SELECT * FROM student_info', function(err, students){
		if (err) throw err;
		for (var i = 0; i<students.rows.length; i++){
			if (username == students.rows[i].username && password == students.rows[i].password){
				renderStudPg(response, students.rows[i].name, students.rows[i].username);
				break;
			}
			else if (i == students.rows.length - 1){
				response.render('homepage.html', {wrong: true});
				break;
			}
		}
	});
}

// check if a date is valid
function checkLegalDate(date) {
	var day = parseInt(date.day);
	var year = parseInt(date.year);

	return (day > 0 && day <= 31) && year > 0;
}

// display admin page
function renderAdminPage(res) {
	var renderObject = {
		rows: [],
		students: []
	};
	// get currently out leaves
	conn.query('SELECT * FROM leave_records WHERE sign_in IS NULL;', function(err, result) {
		if (err) throw err;

		for (var i = 0; i < result.rows.length; i++) {
			var row = result.rows[i];
			renderObject.rows.push({
				name: row.name,
				id: row.name.split(' ').join(''),
				signout_time: row.sign_out
			});
		}

		// get all students
		conn.query('SELECT * FROM student_info;', function(err, result) {
			if (err) throw err;
			for (var i = 0; i < result.rows.length; i++) {
				var row = result.rows[i];
				renderObject.students.push({
					name: row.name,
					student_id: row.name.split(' ').join(''),
					ban_until: row.ban_until != null ? moment(row.ban_until).format('MMMM DD, YYYY') : ''
				});
			}
			res.render('admin.html', renderObject);
		});
	});
}

// add senior info to database on server start
function addStudentsToDB() {
	// in reality this would read names in from a file and enter them in the DB
	// debug test data:
	conn.query('INSERT INTO student_info (name) VALUES ("Thomas Castleman"), ("Stewart Morris"), ("Yuelin Dang"), ("Emmett Barger");');
	console.log("Successfully added student data to db");
}

// socket handling
io.on('connection', function(socket) {
	// on request to sign out
	socket.on('signout', function(data) {
		signout(data.name, socket);
	});

	// on request to sign in
	socket.on('signin', function(data) {
		signin(data.name, socket);
	});

	// on request to make ban
	socket.on('ban', function(data) {
		var date = data.date;
		var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'Novemeber', 'December'];
		// if date is safe
		if (checkLegalDate(data.date)) {
			var date = moment(date.year + '-' + (months.indexOf(date.month) + 1) + '-' + date.day, 'YYYY-MM-DD');

			socket.emit('update ban date', {
				name: data.name,
				date: date.format('MMMM DD, YYYY')
			});
			
			// update ban date
			conn.query('UPDATE student_info SET ban_until = ? WHERE name = ?;', [date.format('YYYY-MM-DD'), data.name], function(err, result) {
				if (err) throw err;
			});
		}
	});
});

// ROUTES:

app.get("/", function(request, response){
	response.render('homepage.html');
});

app.get("/login", function(request, response){
	response.render('login.html');
});

app.post("/student", function(request, response){
	authenticateStudent(request, response);
});

app.get('/student', function(req, res) {
	res.redirect('/');
})

app.get('/admin', function(request, response){
	response.redirect('/login');
});

app.post("/admin", function(request, response){
	authenticateAdmin(response, request.body.password);
});

app.get('/newAccount', function(request, response){
	response.render('newAccount.html');
});

app.post('/newAccount', function(request, response){
	createNewAccount(request, response);
});

// catch all unknown endpoints and redirect
app.get('*', function(req, res) {
	res.redirect('/');
})

server.listen(8080, function() {
	console.log("Senior leaves server listening on port 8080");
	addStudentsToDB();
});