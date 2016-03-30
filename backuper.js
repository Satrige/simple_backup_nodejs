var fs = require('fs'),
	spawn = require('child_process').spawn,
	configs = {};

/*-------------------Common Functions---------------*/
function getLastDir(name) {
	var splittedDirs = name.split('/');

	if (splittedDirs[splittedDirs.length - 1] !== '') {
		return splittedDirs[splittedDirs.length - 1];
	}
	else if (splittedDirs.length > 1) {
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
		console.log("stderr: " + data);
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
			console.log("child process exited with code: " + code + ' err: ' + JSON.stringify(args, null, 4));
			console.log("Smth went wrong at function 'makeArchive'");
		}
	});
}
/**
 * @params
 * @params.curDir {String} - might be empty
 * @params.files {Array}
 */
function deleteFiles(params) {
	var curDir = params.curDir || '',
		files = params.files;

	if (curDir !== '') {
		curDir += '/';
	}

	for (var j in files) {
		fs.unlink(curDir + files[j], function(err) {
			err && console.log(err);
		});
	}
}

function deleteFolderRecursive(path) {
    if (fs.existsSync(path)) {
        fs.readdirSync(path).forEach(function(file, index) {
            var curPath = path + "/" + file;

            if (fs.lstatSync(curPath).isDirectory()) {
                deleteFolderRecursive(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
    }
    else {
    	console.log("There is no file with such name: " + path);
    }
};

/*-------------------Remote Block-------------------*/

function AwsBackup(awsConfigs) {
	this.s3 = require('s3');
	this.bucket = awsConfigs.bucket;
    this.client = this.s3.createClient({
        "maxAsyncS3" : 20, 
        "s3RetryCount" : 3, 
        "s3RetryDelay" : 1000, 
        "multipartUploadThreshold" : 20971520,
        "multipartUploadSize" : 15728640, 
        "s3Options": {
            "accessKeyId" : awsConfigs.aws_access_key_id,
            "secretAccessKey" : awsConfigs.aws_secret_access_key
        },
    });
}

AwsBackup.prototype.backupSingleFile = function(filePath, callback) {
	var self = this,
    	params = {
	        "localFile": filePath,
	        s3Params: {
	            "Bucket" : self.bucket,
	            "Key" : getLastDir(filePath)
	        }
    };

    var uploader = this.client.uploadFile(params);

    uploader.on('error', function(err) {
        console.error("unable to upload:", err.stack);
        callback({
			"res" : "err",
			"descr" : err
		});
    });

    uploader.on('progress', function() {
        console.log("progress", uploader.progressMd5Amount,
            uploader.progressAmount, uploader.progressTotal);
    });

    uploader.on('end', function(result) {
        console.log("done uploading");
        callback({
    		"res" : "ok",
    		"descr" : result
    	});
    });
};

AwsBackup.prototype.backupFiles = function(filesPath, callback) {
	var numFiles = filesPath.length,
		self = this;

	(function singleBackup(numFile) {
		if (numFile < numFiles) {
			self.backupSingleFile(filesPath[numFile], function(result){
				singleBackup(++numFile);
			});
		}
		else {
			console.log("All files were sent to S3.");
			callback({
				"res" : "ok",
				"descr" : "all_sent"
			});
		}
	})(0);
};

function FtpBackup(ftpConfigs) {
	console.log("Constructor of FTP.");
	console.log("FtpBackup is under construction now.");
}

var Remotes = {
	"aws" : AwsBackup,
	"ftp" : FtpBackup
};

/*--------------------------------------------------*/

function Dir2Backup(params) {
	
	this.inputDir = params.inputDir;
	this.outputDir = params.outputDir;
	this.outputArchives = [];
	this.level = params.level || "firstLevel";

	this.subFiles = (this.level === "deep") ? fs.readdirSync(this.inputDir) : [];
}

//TODO Create directories for single file to be compressed
Dir2Backup.prototype.deepArchive = function(callback) {
	var dirsCounter = this.subFiles.length,
		self = this;

	for (var i in this.subFiles) {
		makeArchive({
			"inputDir" : this.inputDir + '/',
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
							deleteFiles({
								"curDir" : self.outputDir,
								"files" : self.outputArchives
							});
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
	if (this.level === "deep") {
		this.deepArchive(callback);
	}
	else {
		this.firstLevelArchive(callback)
	}
};

function SqlBackup(params) {
	this.outputDir = params.outputDir;
	this.dbs = params.dbs;
	this.credentals = params.credentals;

	var curDate = new Date();

	this.outputName = "sqldump_" + curDate.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/\:/g, '_') + ".sql";
}

SqlBackup.prototype.makeDump = function(callback) {
	var self = this,
		path = this.outputDir + '/' + this.outputName,
		args = ["-u", this.credentals.user, "-p" + this.credentals.passwd, "-r", path];

	if (this.dbs === "all") {
		args.push("--all-databases");
	}
	else {
		for (var i in this.dbs) {
			args.push(this.dbs[i]);
		}
	}

	var sqlDump = spawn("mysqldump", args);

	sqlDump.stdout.on('data', function(data) {
		console.log("stdout: " + data);
	});

	sqlDump.stderr.on('data', function(data) {
		console.log("stderr: " + data);
	});

	//TODO add tar compression
	sqlDump.on('close', function(code) {
		if (code === 0) {
			makeArchive({
				"inputDir" : '',
				"inputFiles" : [self.outputDir + self.outputName],
				"outputDir" : self.outputDir,
				"outputFile" : "files_" + self.outputName
			}, function(answ) {
				fs.unlink(self.outputDir + self.outputName, function(err) {
					err && console.log(err);
				});
				callback(answ);
			});
		}
		else {
			console.log("Smth went wrong at function 'makeDump'");
		}
	});
};

function MongoBackup(params) {
	this.outputDir = params.outputDir;
	this.dbs = params.dbs;
	this.credentals = params.credentals;
	this.keys = params.keys;

	var curDate = new Date();

	this.outputName = "mongodump_" + curDate.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/\:/g, '_');
}

MongoBackup.prototype.makeDump = function(callback) {
	var self = this,
		path = this.outputDir + '/' + this.outputName,
		args = [];

	if (this.credentals != null) {
		args = ["-u", this.credentals.user, "-p" + this.credentals.passwd];
	}

	if (this.dbs !== "all") {
		args.push("-dbs");
		for (var i in this.dbs) {
			args.push(this.dbs[i]);
		}
	}

	for (var key in this.keys) {
		args.push("--" + key, this.keys[key]);
	}

	args.push("-o", path);

	console.log("Mongo args: " + JSON.stringify(args, null, 4));

	var mongoDump = spawn("mongodump", args);

	mongoDump.stdout.on('data', function(data) {
		console.log("stdout: " + data);
	});

	mongoDump.stderr.on('data', function(data) {
		console.log("stderr: " + data);
	});

	mongoDump.on('close', function(code) {
		if (code === 0) {
			makeArchive({
				"inputDir" : '',
				"inputFiles" : [self.outputDir + self.outputName],
				"outputDir" : self.outputDir,
				"outputFile" : "files_" + self.outputName
			}, function(answ) {
				deleteFolderRecursive(self.outputDir + self.outputName);

				callback(answ);
			});
		}
		else {
			console.log("Smth went wrong at function 'makeDump'");
		}
	});
};

function Backuper(configs) {
	this.dirs = [];
	for (var numDir in configs.dirs) {
		this.dirs.push(configs.dirs[numDir]);
	}

	this.mySqlInfo = {
		"dbs" : configs.sql.dbs,
		"user" : configs.sql.credentals.user,
		"passwd" : configs.sql.credentals.passwd
	};

	this.mongoInfo = configs.mongo;

	this.outputDir = configs.outputDir;

	//example resulted files
	this.archives = [
	];

	this.remoteMethods = configs.remote;

	var curDate = new Date();
	this.tmpDir = "tmp_" + curDate.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/\:/g, '_');

	fs.mkdirSync(this.outputDir + '/' + this.tmpDir);

	if (configs.purge && configs.purge.need === true) {
		this.purge = true;
		this.purgePeriod = configs.purge.days * 24 * 60 * 60 * 1000;
	}
}

Backuper.prototype.dbBackups = function(type, callback) {
	var self = this,
		dbInst = null;

	if (type === "sql") {
		dbInst = new SqlBackup({
			"outputDir" : this.outputDir + this.tmpDir + '/',
			"dbs" : this.mySqlInfo.dbs,
			"credentals" : {
				"user" : this.mySqlInfo.user,
				"passwd" : this.mySqlInfo.passwd
			}
		});
	}
	else if (type === "mongo") {
		dbInst = new MongoBackup({
			"outputDir" : this.outputDir + this.tmpDir + '/',
			"dbs" : this.mongoInfo.dbs,
			"credentals" : this.mongoInfo.credentals,
			"keys" : this.mongoInfo.keys
		});
	}


	dbInst && dbInst.makeDump(function(resp) {
		if (resp.res === "ok") {
			fs.rename(self.outputDir + '/' + self.tmpDir + '/' +resp.outputArchive, self.outputDir + '/' + resp.outputArchive, function(err) {
				if (err) {
					console.dir(err);
					callback({
						"res" : "err",
						"descr" : err.message
					});
				}
				else {
					callback({
						"res" : "ok",
						"outputArchive" : resp.outputArchive
					});
				}
			});

		}
		else {
			callback(resp);
		}
	});
};

Backuper.prototype.dirsBackup = function(callback) {
	var dirsCounter = this.dirs.length,
		outputArchives = [],
		self = this,
		curDate = new Date();

	for (var i in this.dirs) {
		var curDirInstance = new Dir2Backup({
			"inputDir" : this.dirs[i].path,
			"outputDir" : this.outputDir + this.tmpDir + '/',
			"level" : this.dirs[i].level
		});

		curDirInstance.makeDirsArchive(function(resp) {
			if (resp.res === "ok") {
				outputArchives.push(resp.outputArchive);
				//No need to compress single file, just rename it
				if (--dirsCounter === 0) {
					if (outputArchives.length === 1) {
						var curArchiveName = outputArchives[0];
						var newName = "files_" + curDate.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/\:/g, '_') + ".tar.gz";
						fs.rename(curArchiveName, self.outputDir + '/' + newName, function(err) {
							if (err) {
								console.dir(err);
								callback({
									"res" : "err",
									"descr" : err.message
								});
							}
							else {
								callback({
									"res" : "ok",
									"outputArchive" : newName
								});
							}
						});
					}
					//Need to archive all packs into one
					else {
						makeArchive({
							"inputDir" : '',
							"inputFiles" : outputArchives,
							"outputDir" : self.outputDir,
							"outputFile" : "files_" + curDate.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/\:/g, '_')
						}, function(answ) {
							callback(answ);
						});
					}
				}
			}
			else {
				callback(resp);
				console.log("Smth went wrong");
			}
		});
	}
};

Backuper.prototype.remoteBackup = function() {
	var self = this,
		keys = Object.keys(this.remoteMethods),
		path2Archives = [];

	for (var i in this.archives) {
		path2Archives.push(this.outputDir + '/' + this.archives[i]);
	}

	(function curRemoteBackup(curNum) {
		if (curNum < keys.length) {
			var curMethod = keys[curNum];

			if (self.remoteMethods[curMethod]) {
				var curRemoteInst = new Remotes[curMethod](configs[curMethod]);

				curRemoteInst.backupFiles(path2Archives, function(result) {
					if (result.res === "ok") {
						console.log("Remote backup with '" + curMethod + "' method is done.");
						curRemoteBackup(++curNum);
					}
					else {
						console.log("Smth went wrong: " + result.descr);
					}
				});
			}
			else {
				curRemoteBackup(++curNum);
			}
		}
		else {
			console.log("Remote backups are over.");
		}
	})(0);
}

Backuper.prototype.startPurge = function(callback) {
	var oldDumps = fs.readdirSync(this.outputDir),
		nowDate = new Date().getTime(),
		filesForDelete = [];

	for (var i = 0; i < oldDumps.length; ++i) {
		var filePath = this.outputDir + '/' + oldDumps[i],
			createdDateStr = fs.statSync(filePath).birthtime,
			createdDate = new Date(createdDateStr).getTime();
		if ((nowDate - createdDate) >= this.purgePeriod) {
			console.log("Need to delete: " + filePath);
			filesForDelete.push(filePath);
		}
		else {
			console.log("No need to delete: " + filePath);
		}
	}

	if (filesForDelete.length > 0) {
		deleteFiles({
			"files" : filesForDelete
		});
	}
	
	callback && callback({
		"res" : "ok"
	});
};

Backuper.prototype.startBackups = function(callback) {
	var numBackups = 3,
		self = this;

	var finalFunction = function(resp) {
		if (resp.res === "ok") {
			self.archives.push(resp.outputArchive);
		}
		if (--numBackups === 0) {
			console.log("Archives were saved: " + JSON.stringify(self.archives, null, 4));
			deleteFolderRecursive(self.outputDir + '/' + self.tmpDir);

			if (this.purge) {
				this.startPurge(callback);
			}
			else {
				callback({
					"res" : "ok"
				});
			}
		}
	};

	this.dirsBackup(function(resp) {
		finalFunction(resp);
	});

	this.dbBackups("sql", function(resp) {
		finalFunction(resp);
	});

	this.dbBackups("mongo", function(resp) {
		finalFunction(resp);
	});
};

(function main() {
	var argc = process.argv.length;
	if (argc !== 3) {
		console.log("Wrong number of args. Must be 1.");
	}
	else {
		var confPath = process.argv[2];
		try {
			configs = require(confPath);

			var backuperInst = new Backuper(configs);
			backuperInst.startBackups(function(resp) {
				if (resp.res === "ok") {
					backuperInst.remoteBackup();
				}
			});
		}
		catch (err) {
			console.log("Error: " + err.message);
		}
	}
})();