#!/usr/bin/env node

var http       = require("http"),
    faye       = require("faye"),
    static     = require("node-static"),
    path       = require("path"),
    fs         = require("fs"),
    builder    = require("xmlbuilder"),
    spawn      = require("child_process").spawn,
    os         = require("os"),
    colors     = require('colors'),
    util       = require('util'),
    builder    = require('xmlbuilder');

var WEBROOT    = path.join(path.dirname(__filename), ".."),
    PORT       = process.argv[3] || 8880,
    bayeux     = new faye.NodeAdapter({mount: "/faye", timeout: 100000});

var fileServer = new static.Server(WEBROOT, {cache: false});

var server = http.createServer(function(request, response) {
    request.addListener('end', function (argument) {
        fileServer.serve(request, response);
    });
});

bayeux.attach(server);

server.listen(PORT);

var client = bayeux.getClient(), browsers;
var failures = 0, total = 0;

client.subscribe("/ready", function(agent) {
    client.publish('/load', "/" + url);
});

var doc = builder.create();
var root = doc.begin('testsuite');

url = process.argv[2] || 'tests/';

client.subscribe('/testDone', function(message) {
  var agent = message.agent.match(/(Firefox|Chrome)\/(\d+)/);
  agent = agent[1] + agent[2];
  var testCase = root.ele('testcase')
    .att('name', message.name)
    .att('time', message.duration)
    .att('classname', agent + "." + message.suite);


  if (message.failed > 0) {
    process.stderr.write("*********************************************************************************************\n");
    process.stderr.write("FAIL: " + agent + " -- " + message.suite + " : " + message.name + "(" + message.duration + "ms)" + "\n");
    process.stderr.write(message.failures.join("\n") + "\n");
    process.stderr.write("*********************************************************************************************\n");
    testCase.ele('failure').txt(message.failures.join("\n"));
  } else {
    process.stderr.write("pass: " + agent + " -- " + message.suite + " : " + message.name + "(" + message.duration + "ms)" + "\n");
  }
});

client.subscribe('/done', function(message) {
    failures += message.failures;
    total += message.total;

    if (!--runningAgents) {
        outputAndExit();
    }
});

var browserProcesses = [],
    testRunnerURL = 'http://localhost:' + PORT + '/tests/testrunner.html',
    browsers;

if (os.type() === "Darwin") {
    browsers =  [{
            exe: "/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome",
            params: [testRunnerURL]
        },{
            exe: "/Applications/Firefox.app/Contents/MacOS/firefox",
            params: ['-private', '-no-remote', '-new-window', testRunnerURL]
    }];
} else {
    /**
     * Google Chrome parameters below are "seen" in the selenium python driver source code:
     * http://code.google.com/searchframe#2tHw6m3DZzo/trunk/chrome/src/py/driver.py&q=data-dir%20package:selenium%5C.googlecode%5C.com&ct=rc&cd=1&sq=
     */
    browsers =  [{
            exe: "xvfb-run",
            params: [
                "-e",
                "xvfb-run.log",
                "-a",
                "google-chrome",
                "--user-data-dir=" + process.env["BROWSER_TEMP"],
                "--activate-on-launch",
                "--homepage=about:blank",
                "--no-first-run",
                "--no-default-browser-check",
                testRunnerURL
            ]
        },{
            exe: "xvfb-run",
            params: [
                "-e",
                "xvfb-run.log",
                "-a",
                "firefox",
                '-private',
                '-no-remote',
                '-P',
                process.env["FIREFOX_PROFILE"],
                '-new-window',
                testRunnerURL
            ]
    }];
}

var runningAgents = browsers.length;

browsers.forEach(function(browser, index) {
    setTimeout(function() {
        var child = spawn(browser.exe, browser.params);
        process.stderr.write("Executing " + browser.exe + " " + browser.params.join(" ") + " PID: " + child.pid + "\n");

        child.stderr.on("data", function(data) {
            process.stderr.write(data);
        });

        child.stdout.on("data", function(data) {
            process.stderr.write(data);
        });

        child.on("exit", function(code, signal) {
            process.stderr.write(child.pid + " Exited with " + code + " Signal :" + signal + "\n");
        });

        browserProcesses.push(child);
    }, 100 * index);
});

function outputAndExit() {
    browserProcesses.forEach(function(child) {
        spawn("pkill", ["-P", child.pid]);
    });

    root.att('tests', total)
        .att('errors', 0)
        .att('failures', failures);

    process.stdout.write(doc.toString({pretty: true}));
    process.exit(failures === 0 ? 0 : 1);
}
