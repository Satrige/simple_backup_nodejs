var fs = require('fs'),
	spawn = require('child_process').spawn;

function getLastDir(name) {
	var splittedDirs = name.split('/');

	if (splittedDirs[splittedDirs.length - 1] !== '') {
		return splittedDirs[splittedDirs.length - 1];
	}
	else if (splittedDirs.length > 1){
		return splittedDirs[splittedDirs.length - 2];
	}
	else {
		return '';
	}
}

function makeArchive(params, callback) {
	var inputDir = params.inputDir,
		inputFiles = params.inputFiles,
		outputDir = params.outputDir,
		outputFile = params.outputFile;

	var ouputName = outputDir +  outputFile + '.tar.gz',	
		args = ["-zcf", ouputName];

	for (var i in inputFiles) {
		args.push(inputDir + inputFiles[i]);
	}

	// console.log("====================================");
	// console.log(JSON.stringify(args, null, 4));
	// console.log("====================================");

	var archive = spawn("tar", args);

	archive.stdout.on('data', function(data) {
		console.log("stdout: " + data);
	});

	archive.stderr.on('data', function(data) {
		//console.log("stderr: " + data);
	});

	archive.on('close', function(code) {
		//console.log("child process exited with code: " + code);
		if (code === 0) {
			callback({
				"res" : "ok",
				"outputArchive" : outputFile + '.tar.gz'
			});
		}
		else {
			console.log("Smth went wrong at function 'makeArchive'");
		}
	});
}

function Dir2Backup(params) {
	var inputDir = params.inputDir,
		outputDir = params.outputDir;

	this.inputDir = inputDir;
	this.outputDir = outputDir;
	this.outputArchives = [];
	this.level = params.level || 1;

	this.subFiles = (this.level === 1) ? fs.readdirSync(this.inputDir) : [];
}

Dir2Backup.prototype.deepArchive = function(callback) {
	var dirsCounter = this.subFiles.length,
		self = this;

	for (var i in this.subFiles) {
		makeArchive({
			"inputDir" : this.inputDir,
			"inputFiles" : [this.subFiles[i]],
			"outputDir" : this.outputDir,
			"outputFile" : this.subFiles[i]
		}, function(resp) {
			if (resp.res === "ok") {
				self.outputArchives.push(resp.outputArchive);

				if (--dirsCounter === 0) {
					makeArchive({
						"inputDir" : self.outputDir,
						"inputFiles" : self.outputArchives,
						"outputDir" : self.outputDir,
						"outputFile" : getLastDir(self.inputDir)
					}, function(wholeResp) {
						if (wholeResp.res === "ok") {
							callback({
								"res" : "ok",
								"outputArchive" : self.outputDir + '/' + wholeResp.outputArchive
							});
							for (var j in self.outputArchives) {
								fs.unlink(self.outputDir + '/' + self.outputArchives[j], function(err) {
									err && console.log(err);
								});
							}
						}
						else {
							callback(wholeResp);
						}
					});
				}
			}
			else {
				console.log("Smth went wrong at 'makeDirsArchive' function");
			}
		});
	}
};

Dir2Backup.prototype.firstLevelArchive = function(callback) {
	var self = this;

	makeArchive({
		"inputDir" : this.inputDir,
		"inputFiles" : [''],
		"outputDir" : this.outputDir,
		"outputFile" : getLastDir(this.inputDir)
	}, function(resp) {
		if (resp.res === "ok") {
			callback({
				"res" : "ok",
				"outputArchive" : self.outputDir + '/' + resp.outputArchive
			});
		}
		else {
			callback(resp);
		}
	});
};

Dir2Backup.prototype.makeDirsArchive = function(callback) {
	if (this.level === 1) {
		this.deepArchive(callback);
	}
	else {
		this.firstLevelArchive(callback)
	}
};

function Backuper() {
	this.dirs = [
		{
			"path" :  "./test/dirBackup/",
			"level" : 1
		},
		{
			"path" : "./test/subDir/",
			"level" : 2
		}
	];

	this.mySqlInfo = {
		"dbs" : [
			""
		],
		"user" : "",
		"passwd" : ""
	};

	this.outputDir = "./test/backups/";
}

Backuper.prototype.dirsBackup = function(callback) {
	var dirsCounter = this.dirs.length,
		outputArchives = [],
		self = this;

	for (var i in this.dirs) {
		var curDirInstance = new Dir2Backup({
			"inputDir" : this.dirs[i].path,
			"outputDir" : this.outputDir,
			"level" : this.dirs[i].level
		});


		curDirInstance.makeDirsArchive(function(resp) {
			if (resp.res === "ok") {
				//console.log("resp: " + JSON.stringify(resp, null, 4));
				outputArchives.push(resp.outputArchive);
				if (--dirsCounter === 0) {
					var curDate = new Date();
					makeArchive({
						"inputDir" : '',
						"inputFiles" : outputArchives,
						"outputDir" : self.outputDir,
						"outputFile" : "files_" + curDate.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/\:/g, '_')
					}, function(answ) {
						callback(answ);
						if (answ.res === "ok") {
							for (var j in outputArchives) {
								fs.unlink(outputArchives[j], function(err) {
									err && console.log(err);
								});
							}
						}
					});
				}
			}
			else {
				console.log("Smth went wrong");
			}
		});
	}
};

Backuper.prototype.startBackups = function() {
	this.dirsBackup(function(resp) {
		console.dir(resp);
	});
};

var backuperInst = new Backuper();

backuperInst.startBackups();