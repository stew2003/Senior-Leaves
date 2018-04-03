v
$(document).ready(function() {
	$('input').val('');

	var socket = io();
	var selectedBanData = {
		month: "January"
	};

	var selectedName;

	function getID(name) {
		return name.split(' ').join('');
	}

	// on sign out, add new student to table
	socket.on('new sign out', function(data) {
		var id = getID(data.name);
		$('#currently_out').append('<tr id="' + id + '"><td>' + data.name + '</td><td>' + data.signout_time + '</td></tr>');
	});

	// on sign in, remove student from table
	socket.on('new sign in', function(data) {
		var id = '#' + getID(data.name);
		$(id).remove();	// remove signed out student from table
	});

	socket.on('update ban date', function(data) {
		console.log(data);
		var id = '#' + getID(data.name);
		$(id).children().eq(1).text(data.date);
	});

	$('.ban').click(function() {
		selectedName = $(this).parent().siblings(":first").text();
		$('#selected_student').text(selectedName);
		$('#ban_inputs').show();
	});

	$('#submit_ban').click(function() {
		console.log(selectedBanData);
		console.log(selectedName);

		if (selectedName != undefined && selectedBanData.day != undefined && selectedBanData.year != undefined) {
			socket.emit('ban', {
				name: selectedName,
				date: selectedBanData
			});
			$('#ban_inputs').hide();
		}
	});

	$('#day_select').change(function() {
		selectedBanData.day = $(this).val();
	});

	$('#month_select').change(function() {
		selectedBanData.month = $(this).val();
	});

	$('#year_select').change(function() {
		selectedBanData.year = $(this).val();
	});
});