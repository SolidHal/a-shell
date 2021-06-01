// functions to deal with executeJavaScript: 
function print(printString) {
	window.webkit.messageHandlers.aShell.postMessage('print:' + printString);
}
function println(printString) {
	window.webkit.messageHandlers.aShell.postMessage('print:' + printString + '\n');
}
function print_error(printString) {
	window.webkit.messageHandlers.aShell.postMessage('print_error:' + printString);
}

function luminance(color) {
	var colorArray = lib.colors.crackRGB(color);
	return colorArray[0] * 0.2126 + colorArray[1] * 0.7152 + colorArray[2] *  0.0722;
}

function initContent(io) {
	const ver = lib.resource.getData('libdot/changelog/version');
	const date = lib.resource.getData('libdot/changelog/date');
	const pkg = `libdot ${ver} (${date})`;
};

function isInteractive(commandString) {
	// If the command is interactive or contains interactive commands, set the flag,
	// forward all keyboard input, let them deal with command history.
	// TODO: have a list of such interactive commands (array?) 
	// jump can start vim 
	// ssh and ssh-keygen (new version) are both interactive. So is scp. sftp is interactive until connected.
	let interactiveRegexp = /^vim|^ipython|^ptpython|^less|^more|^ssh|^scp|^sftp|^jump|\|&? *less|\|&? *more|^man/;
	return interactiveRegexp.test(commandString) 
	// It's easier to match a regexp, then take the negation than to test a regexp that does not contain a pattern:
	// This is disabled for now, but kept in case it can become useful again.
	// let notInteractiveRegexp = /^ssh-keygen/;
	// return interactiveRegexp.test(commandString) && !notInteractiveRegexp.test(commandString);
}

// standard functions (terminal, autocomplete, etc)
var lastDirectory = '';
var fileList = [];
var currentCommandCursorPosition;
var autocompleteList = []; 
var autocompleteOn = false;
var autocompleteIndex = 0;

function disableAutocompleteMenu() {
	printString('');
	autocompleteOn = false;
	autocompleteList = [];
	autocompleteIndex = 0;
	fileList = '';
	lastDirectory = '';
}

function isLetter(c) {
	// TODO: extension for CJK characters (hard)
	return (c.toLowerCase() != c.toUpperCase());
}

function printPrompt() {
	// prints the prompt and initializes all variables related to prompt position
	window.term_.io.print('\x1b[0m\x1b[39;49m');  // default font, default color
	// cut window.printedContent if it gets too large:
	if (window.printedContent.length > 30000) {
		window.printedContent = window.printedContent.substring(5000);
	}
	if (window.commandRunning == '') {
		window.term_.io.print(window.promptMessage); 
		window.commandRunning = '';
		window.interactiveCommandRunning = false;
	} else {
		// let the running command print its own prompt:
		window.webkit.messageHandlers.aShell.postMessage('input:' + '\n');
	}
}

function updatePromptPosition() {
	window.promptEnd = window.term_.screen_.cursorPosition.column;
	// required because some commands can take several lines, especially on a phone.
	window.promptLine = window.term_.screen_.cursorPosition.row;
	window.promptScroll = window.term_.scrollPort_.getTopRowIndex();
	currentCommandCursorPosition = 0; 
}

// prints a string and move the rest of the command around, even if it is over multiple lines
// we use lib.wc.strWidth instead of length because of multiple-width characters (CJK, mostly).
// TODO: get correct character width for emojis.
function printString(string) {
	var l = lib.wc.strWidth(string);

	var currentCommand = window.term_.io.currentCommand;
	// clear the rest of the line, then reprint. 
	window.term_.io.print('\x1b[0J'); // delete display after cursor
	window.term_.io.print(string);

	// print remainder of command line
	window.term_.io.print(currentCommand.slice(currentCommandCursorPosition, currentCommand.length));
	// move cursor back to where it was (don't use term.screen_.cursorPosition):
	var endOfCommand = currentCommand.slice(currentCommandCursorPosition, currentCommand.length);
	var endOfCommandWidth = lib.wc.strWidth(endOfCommand);
	if ((lib.wc.strWidth(currentCommand) + lib.wc.strWidth(window.promptMessage) + 1 >= window.term_.screenSize.width) && (endOfCommandWidth == 0)) {
		window.term_.io.print(' ');
		endOfCommandWidth = 1;
	} 
	for (var i = 0; i < endOfCommandWidth; i++) {
		window.term_.io.print('\b'); 
	}
}

// prints a string for autocomplete and move the rest of the command around, even if it is over multiple lines.
// keep the command as it is until autocomplete has been accepted.
function printAutocompleteString(string) {
	var currentCommand = window.term_.io.currentCommand;
	// clear entire buffer, then reprint
	window.term_.io.print('\x1b[0J'); // delete display after cursor
	if (luminance(window.term_.getBackgroundColor()) < luminance(window.term_.getForegroundColor())) {
		// We are in dark mode. Use yellow font for higher contrast
		window.term_.io.print('\x1b[33m'); // yellow

	} else {
		window.term_.io.print('\x1b[32m'); // green
	}
	window.term_.io.print(string); 
	window.term_.io.print('\x1b[39m'); // back to normal foreground color
	// print remainder of command line
	window.term_.io.print(currentCommand.slice(currentCommandCursorPosition, currentCommand.length))
	// move cursor back to where it was (don't use term.screen_.cursorPosition):
	// don't use length because of multiple-byte chars.
	var endOfCommand = currentCommand.slice(currentCommandCursorPosition, currentCommand.length);
	var wcwidth = lib.wc.strWidth(endOfCommand) + lib.wc.strWidth(string);
	for (var i = 0; i < wcwidth; i++) {
		window.term_.io.print('\b'); 
	}
}

// behaves as if delete key is pressed.
function deleteBackward() {
	if (currentCommandCursorPosition <= 0) {
		return;
	}

	const currentChar = window.term_.io.currentCommand[currentCommandCursorPosition - 1];
	const currentCharWidth = lib.wc.strWidth(currentChar);
	for (let i = 0; i < currentCharWidth; i++) {
		window.term_.io.print('\b'); // move cursor back n chars, across lines
	}

	window.term_.io.print('\x1b[0J'); // delete display after cursor

	// print remainder of command line
	const endOfCommand = window.term_.io.currentCommand.slice(currentCommandCursorPosition);
	window.term_.io.print(endOfCommand);

	// move cursor back to where it was (don't use term.screen_.cursorPosition):
	const wcwidth = lib.wc.strWidth(endOfCommand);
	for (let i = 0; i < wcwidth; i++) {
		window.term_.io.print('\b');
	}

	// remove character from command at current position:
	window.term_.io.currentCommand = window.term_.io.currentCommand.slice(0, currentCommandCursorPosition - 1) + endOfCommand;
	currentCommandCursorPosition -= 1;
}

function pickCurrentValue() {
	var currentCommand = window.term_.io.currentCommand;
	var cursorPosition = window.term_.screen_.cursorPosition.column - window.promptEnd;
	selected = autocompleteList[autocompleteIndex]; 
	printString(selected);
	window.term_.io.currentCommand = currentCommand.slice(0, currentCommandCursorPosition) + selected + 
		currentCommand.slice(currentCommandCursorPosition, currentCommand.length);
	// is not enough to push the rest of the command if it's longer than a line
	currentCommandCursorPosition += selected.length;
	disableAutocompleteMenu();
}

// called once the list of files has been updated, asynchronously. 
function updateFileMenu() {
	var cursorPosition = window.term_.screen_.cursorPosition.column - window.promptEnd;
	updateAutocompleteMenu(window.term_.io, cursorPosition);
}

function updateAutocompleteMenu(io, cursorPosition) {
	var lastFound = '';
	// string to use for research: from beginning of line to cursor position
	var rootForMatch = io.currentCommand.slice(0, currentCommandCursorPosition);
	var predicate = rootForMatch;
	var n = predicate.lastIndexOf("|");
	if (n < predicate.length) {
		var predicate = predicate.substr(n + 1);
	}
	n = predicate.lastIndexOf(" ");
	while ((n > 0) && (predicate[n-1] == "\\")) { 
		// escaped space
		n = predicate.lastIndexOf(" ", n - 1);
	}
	if (n < predicate.length) {
		var predicate = predicate.substr(n + 1);
	}
	n = predicate.lastIndexOf(">");
	if (n < predicate.length) {
		var predicate = predicate.substr(n + 1);
	}
	if (predicate[0] == '-') return; // arguments to function, no autocomplete
	// we have the string to use for matching (predicate). Is it a file or a command?
	var beforePredicate = rootForMatch.substr(0, rootForMatch.lastIndexOf(predicate));
	// remove all trailing spaces:
	while ((beforePredicate.length > 0) && (beforePredicate.slice(-1) == " ")) {
		beforePredicate = beforePredicate.slice(0, beforePredicate.length - 1)
	}
	autocompleteIndex = 0; 
	autocompleteList = [];
	var matchToCommands = false;
	if (beforePredicate.length == 0) {
		matchToCommands = true; // beginning of line, must be a command
	} else if (beforePredicate.slice(-1) == "|") {
		matchToCommands = true; // right after a pipe, must be a command
	}
	// otherwise, it's probably a file
	var numFound = 0; 
	var file = '';
	if (matchToCommands) { 
		for (var i = 0, len = commandList.length; i < len; i++) {
			if (commandList[i].startsWith(predicate)) {
				var value = commandList[i].replace(predicate, "") + ' '; // add a space at the end if it's a command; 
				autocompleteList[numFound] = value;
				lastFound = value; 
				numFound += 1;
			}
		}
	} else {
		if ((predicate[0] == "~") && (predicate.lastIndexOf("/") == -1)) {
			// string beginning with ~, with no / at the end: it's a bookmark.
			directory = '';
			file = predicate;
			if (lastDirectory == '~bookmarkNames') {
				// First, remove 
				for (var i = 0, len = fileList.length; i < len; i++) {
					if (fileList[i].startsWith(file)) {
						var value = fileList[i].replace(file, "")
						autocompleteList[numFound] = value; 
						lastFound = value; 
						numFound += 1;
					}
				}
			} else {
				// asynchronous communication. Will have to execute the rest of the command too.
				window.webkit.messageHandlers.aShell.postMessage('listBookmarks:');
			}
		} else {
			if ((predicate[0] == "/") && (predicate.lastIndexOf("/") == 0)) {
				// special case for root
				directory = "/";
				file = predicate.substr(1);
				// This will only work for shortcuts expansion:
			} else {
				var lastSlash = predicate.lastIndexOf("/");
				if ((predicate.length > 0) && (lastSlash > 0) && (lastSlash < predicate.length)) {
					var directory = predicate.substr(0, lastSlash); // include "/" in directory
					file = predicate.substr(lastSlash + 1); // don't include "/" in file name
				} else {
					var directory = ".";
					file = predicate;
				}
			}
			// Need to get list of files from directory. 
			if (directory == lastDirectory) {
				// First, remove 
				for (var i = 0, len = fileList.length; i < len; i++) {
					if (fileList[i].startsWith(file)) {
						var value = fileList[i].replace(file, "")
						autocompleteList[numFound] = value; 
						lastFound = value; 
						numFound += 1;
					}
				}
			} else {
				// asynchronous communication. Will have to execute the rest of the command too.
				window.webkit.messageHandlers.aShell.postMessage('listDirectory:' + directory);
			}
		}
	}
	// substring of io.currentCommand, ending at currentCommandCursorPosition, going back until first space or "/"
	// list to use for autocomplete = commandList if at beginning of line (modulo spaces) or after | (module spaces)
	// list of files inside directory otherwise. e.g. "../Library/Preferences/" (going back until next space)
	// TODO: no autocomplete on file for commands that don't operate on files (difficult)
	if (numFound > 1) {
		// If list is not empty:
		// Find largest starting substring:
		var commonSubstring = ''
		for (var l = 1; l < autocompleteList[0].length; l++) {
			substring =  autocompleteList[0].substr(0, l)
			var contained = true
			for (var i = 0, len = autocompleteList.length; i < len; i++) {
				if (!autocompleteList[i].startsWith(substring)) {
					contained = false;
					break;
				}
			}
			if (contained) { 
				commonSubstring = substring;
			} else {
				break;
			}
		}
		if (commonSubstring.length > 0) {
			printString(commonSubstring);
			io.currentCommand = io.currentCommand.slice(0, currentCommandCursorPosition) + commonSubstring + 
				io.currentCommand.slice(currentCommandCursorPosition, io.currentCommand.length);
			currentCommandCursorPosition += commonSubstring.length;
			for (var i = 0, len = autocompleteList.length; i < len; i++) {
				var value = autocompleteList[i].replace(commonSubstring, "")
				autocompleteList[i] = value; 
			}
		}
		//
		autocompleteOn = true;
		// Don't display files starting with "." first (they're in the list, but we don't start with them)
		if (file.length == 0) {
			while ((autocompleteList[autocompleteIndex][0] == ".") && (autocompleteIndex < autocompleteList.length - 1)) {
				autocompleteIndex += 1;
			} 
			if (autocompleteIndex == autocompleteList.length - 1) {
				// directory with only ".*" files
				autocompleteIndex = 0;
			}
		}
		printAutocompleteString(autocompleteList[autocompleteIndex]);
	} else {
		if (numFound == 1) {
			printString(lastFound);
			io.currentCommand = io.currentCommand.slice(0, currentCommandCursorPosition) + lastFound + 
				io.currentCommand.slice(currentCommandCursorPosition, io.currentCommand.length);
			currentCommandCursorPosition += lastFound.length;
		}
		disableAutocompleteMenu(); 
	}
}

function setupHterm() {
	const term = new hterm.Terminal();
	// Default monospaced fonts installed: Menlo and Courier. 
	term.prefs_.set('cursor-shape', 'BLOCK'); 
	term.prefs_.set('font-family', window.fontFamily);
	term.prefs_.set('font-size', window.fontSize); 
	term.prefs_.set('foreground-color', window.foregroundColor);
	term.prefs_.set('background-color', window.backgroundColor);
	term.prefs_.set('cursor-color', window.cursorColor);
	term.prefs_.set('cursor-blink', false); 
	term.prefs_.set('enable-clipboard-notice', false); 
	term.prefs_.set('use-default-window-copy', true); 
	term.prefs_.set('clear-selection-after-copy', true); 
	term.prefs_.set('copy-on-select', false);
	term.prefs_.set('audible-bell-sound', '');
	term.prefs_.set('receive-encoding', 'utf-8'); 
	term.prefs_.set('meta-sends-escape', 'false'); 

	term.setReverseWraparound(true);
	term.setWraparound(true);
	//
	term.onCut = function(e) { 
		var text = this.getSelectionText();  
		// compose events tend to create a selection node with range, which breaks insertion:
		if (text == null) { 
			// TODO: force the HTML cursor to go back to the actual cursor position (HOW?)
			this.document_.getSelection().collapse(this.scrollPort_.getScreenNode());
			return;
		}
		// We also need to remove it from the command line -- if it is in.
		var startRow = this.scrollPort_.selection.startRow.rowIndex;
		var endRow = this.scrollPort_.selection.endRow.rowIndex;
		if ((startRow >= window.promptScroll + window.promptLine ) &&
			(endRow >= window.promptScroll + window.promptLine )) {
			// the selected text is inside the current command line: we can cut it.
			// startOffset = position of selection from start of startRow (not necessarily start of command)
			var startOffset = this.scrollPort_.selection.startOffset;
			// endOffset = position of selection from start of endRow (not used)
			var endOffset = this.scrollPort_.selection.endOffset;
			var startPosition = ((startRow - window.promptScroll - window.promptLine) * this.screenSize.width) + startOffset;
			var xcursor = startOffset;
			var cutText = this.io.currentCommand.slice(startPosition, startPosition + text.length); 
			if (cutText == text) {
				this.io.currentCommand =  this.io.currentCommand.slice(0, startPosition) + this.io.currentCommand.slice(startPosition + text.length, this.io.currentCommand.length); 
				xcursor += window.promptEnd;
			} else {
				// startOffset can sometimes be off by promptLength. 
				startPosition -= window.promptEnd; 
				var cutText = this.io.currentCommand.slice(startPosition, startPosition + text.length); 
				if (cutText == text) {
					this.io.currentCommand =  this.io.currentCommand.slice(0, startPosition) + this.io.currentCommand.slice(startPosition + text.length, this.io.currentCommand.length); 
				} else {
					window.webkit.messageHandlers.aShell.postMessage("Cannot find text = " + text + " in " + this.io.currentCommand); 
					// Do not cut if we don't agree on what to cut
					if (e != null) {
						e.preventDefault();
					}
					return false; 
				}
			}
			// Move cursor to startLine, startOffset
			// We redraw the command ourselves because iOS removes extra spaces around the text.
			// var scrolledLines = window.promptScroll - term.scrollPort_.getTopRowIndex();
			// io.print('\x1b[' + (window.promptLine + scrolledLines + 1) + ';' + (window.promptEnd + 1) + 'H'); // move cursor to position at start of line
			currentCommandCursorPosition = startPosition
			var ycursor = startRow - this.scrollPort_.getTopRowIndex();
			this.io.print('\x1b[' + (ycursor + 1) + ';' + (xcursor + 1) + 'H'); // move cursor to new position 
			this.io.print('\x1b[0J'); // delete display after cursor
			var endOfCommand = this.io.currentCommand.slice(startPosition, this.io.currentCommand.length); 
			this.io.print(endOfCommand); 
			this.io.print('\x1b[' + (ycursor + 1) + ';' + (xcursor + 1) + 'H'); // move cursor back to new position 
			window.webkit.messageHandlers.aShell.postMessage('copy:' + text); // copy the text to clipboard. We can't use JS fonctions because we removed the text.
			return true;
		}
		// Do not cut if we are outside the command line:
		if (e != null) {
			e.preventDefault();
			return false;
		}
	};

	// 
	term.onTerminalReady = function() {
		const io = this.io.push();
		io.onVTKeystroke = (string) => {
			if (window.controlOn) {
				// produce string = control + character 
				var charcode = string.toUpperCase().charCodeAt(0);
				string = String.fromCharCode(charcode - 64);
				window.controlOn = false;
				window.webkit.messageHandlers.aShell.postMessage('controlOff');
			}
			// always post keyboard input to TTY:
			window.webkit.messageHandlers.aShell.postMessage('inputTTY:' + string);
			// If help() is running in iPython, then it stops being interactive.
			var helpRunning = false;
			if (window.commandRunning.startsWith("ipython")) {
				var lastNewline = window.printedContent.lastIndexOf("\n");
				var lastLine = window.printedContent.substr(lastNewline + 2); // skip \n\r
				if (lastLine.startsWith("help>")) {
					helpRunning = true;
				} else if (lastLine.includes("Do you really want to exit ([y]/n)?")) {
					helpRunning = true;
				}
			}
			if (window.interactiveCommandRunning && !helpRunning) {
				// specific treatment for interactive commands: forward all keyboard input to them
				// window.webkit.messageHandlers.aShell.postMessage('sending: ' + string); // for debugging
				// post keyboard input to stdin
				window.webkit.messageHandlers.aShell.postMessage('inputInteractive:' + string);
			} else if ((window.commandRunning != '') && ((string.charCodeAt(0) == 3) || (string.charCodeAt(0) == 4))) {
				// Send control messages back to command:
				// first, flush existing input:
				if (io.currencCommand != '') {
					window.webkit.messageHandlers.aShell.postMessage('input:' + io.currentCommand);
					io.currentCommand = '';
				}
				window.webkit.messageHandlers.aShell.postMessage('input:' + string);
			} else { 
				if (io.currentCommand === '') { 
					// new line, reset things: (required for commands inside commands)
					updatePromptPosition(); 
				}
				var cursorPosition = term.screen_.cursorPosition.column - window.promptEnd;  // remove prompt length
				switch (string) {
					case '\r':
						if (autocompleteOn) {
							// Autocomplete menu being displayed + press return: select what's visible and remove
							pickCurrentValue();
							break;
						}
						// Before executing command, move to end of line if not already there:
						// Compute how many lines should we move downward:
						var beginCommand = io.currentCommand.slice(0, currentCommandCursorPosition); 
						var lineCursor = Math.floor((lib.wc.strWidth(beginCommand) + window.promptEnd)/ term.screenSize.width);
						var lineEndCommand = Math.floor((lib.wc.strWidth(io.currentCommand) + window.promptEnd)/ term.screenSize.width);
						for (var i = 0; i < lineEndCommand - lineCursor; i++) {
							io.println('');
						}
						io.println('');
						if (window.commandRunning != '') {
							// The command takes care of the prompt. Just send the input data:
							window.webkit.messageHandlers.aShell.postMessage('input:' + io.currentCommand + '\n');
							// remove temporarily stored command -- if any
							if (window.maxCommandInsideCommandIndex < window.commandInsideCommandArray.length) {
								window.commandInsideCommandArray.pop();
							}
							// only store non-empty commands:
							// store commands sent:
							if (io.currentCommand.length > 0) {
								if (io.currentCommand != window.commandInsideCommandArray[window.maxCommandInsideCommandIndex - 1]) {
									// only add command to history if it is different from the last one:
									window.maxCommandInsideCommandIndex = window.commandInsideCommandArray.push(io.currentCommand); 
								}
							} 
							while (window.maxCommandInsideCommandIndex >= 100) {
								// We have stored more than 100 commands
								window.commandInsideCommandArray.shift(); // remove first element
								window.maxCommandInsideCommandIndex = window.commandInsideCommandArray.length;
							} 
							window.commandInsideCommandIndex = window.maxCommandInsideCommandIndex; 
						} else {
							if (io.currentCommand.length > 0) {
								// Now is the time where we send the command to iOS: 
								window.webkit.messageHandlers.aShell.postMessage('shell:' + io.currentCommand);
								// and reinitialize:
								window.commandRunning = io.currentCommand;
								window.interactiveCommandRunning = isInteractive(window.commandRunning);
								// remove temporarily stored command -- if any
								if (window.maxCommandIndex < window.commandArray.length) {
									window.commandArray.pop();
								}
								if (io.currentCommand != window.commandArray[window.maxCommandIndex - 1]) {
									// only add command to history if it is different from the last one:
									window.maxCommandIndex = window.commandArray.push(window.commandRunning); 
									while (window.maxCommandIndex >= 100) {
										// We have stored more than 100 commands
										window.commandArray.shift(); // remove first element
										window.maxCommandIndex = window.commandArray.length;
									} 
								} 
								window.commandIndex = window.maxCommandIndex; 
								// clear history inside command:
								window.commandInsideCommandArray = [];
								window.commandInsideCommandIndex = 0;
								window.maxCommandInsideCommandIndex = 0;
							} else {
								printPrompt();
								updatePromptPosition(); 
							}
						}
						io.currentCommand = '';
						break;
					case String.fromCharCode(127): // delete key from iOS keyboard
						if (currentCommandCursorPosition > 0) { 
							if (this.document_.getSelection().type == 'Range') {
								term.onCut(null); // remove the selection without copying it
							} else {
								deleteBackward();
							}
						}
						disableAutocompleteMenu();
						break;
					case String.fromCharCode(27):  // Escape. Make popup menu disappear
						disableAutocompleteMenu();
						break;
					case String.fromCharCode(27) + "[A":  // Up arrow
					case String.fromCharCode(27) + "[1;3A":  // Alt-Up arrow
					case String.fromCharCode(16):  // Ctrl+P
						if (window.commandRunning != '') {
							if (window.commandInsideCommandIndex > 0) {
								if (window.commandInsideCommandIndex === window.maxCommandInsideCommandIndex) {
									// Store current command: 
									window.commandInsideCommandArray[window.commandInsideCommandIndex] = io.currentCommand;
								}
								io.print('\x1b[' + (window.promptLine + 1) + ';' + (window.promptEnd + 1) + 'H'); // move cursor back to initial position
								io.print('\x1b[0J'); // delete display after cursor
								if (string != String.fromCharCode(27) + "[1;3A") {
									window.commandInsideCommandIndex -= 1;
									if (window.commandInsideCommandIndex < 0) {
										window.commandInsideCommandIndex = 0;
									}
								} else {
									window.commandInsideCommandIndex -= 5;
									if (window.commandInsideCommandIndex < 0) {
										window.commandInsideCommandIndex = 0;
									}
								}
								io.currentCommand = window.commandInsideCommandArray[window.commandInsideCommandIndex]; 
								io.print(io.currentCommand);
								currentCommandCursorPosition = io.currentCommand.length;
							}
						} else {
							// popup menu being displayed, change it:
							if (autocompleteOn) {
								if (autocompleteIndex > 0) {
									autocompleteIndex -= 1; 
									printAutocompleteString(autocompleteList[autocompleteIndex]);
								}													
								break;
							}
							if (window.commandIndex > 0) {
								if (window.commandIndex === window.maxCommandIndex) {
									// Store current command: 
									window.commandArray[window.commandIndex] = io.currentCommand;
								}
								var scrolledLines = window.promptScroll - term.scrollPort_.getTopRowIndex();
								io.print('\x1b[' + (window.promptLine + scrolledLines + 1) + ';' + (window.promptEnd + 1) + 'H'); // move cursor to position at start of line
								io.print('\x1b[0J'); // delete display after cursor
								if (string != String.fromCharCode(27) + "[1;3A") {
									window.commandIndex -= 1;
								} else {
									window.commandIndex -= 5;
									if (window.commandIndex < 0) {
										window.commandIndex = 0;
									}
								}
								io.currentCommand = window.commandArray[window.commandIndex]; 
								io.print(io.currentCommand);
								currentCommandCursorPosition = io.currentCommand.length;
							} 
						}
						break;
					case String.fromCharCode(27) + "[B":  // Down arrow
					case String.fromCharCode(27) + "[1;3B":  // Alt-Down arrow
					case String.fromCharCode(14):  // Ctrl+N
						if (window.commandRunning != '') {
							if (window.commandInsideCommandIndex < window.maxCommandInsideCommandIndex) {
								io.print('\x1b[' + (window.promptLine + 1) + ';' + (window.promptEnd + 1) + 'H'); // move cursor to position at start of line
								io.print('\x1b[0J'); // delete display after cursor
								if (string != String.fromCharCode(27) + "[1;3B") {
									window.commandInsideCommandIndex += 1;
								} else {
									window.commandInsideCommandIndex += 5;
									if (window.commandInsideCommandIndex >= window.maxCommandInsideCommandIndex) {
										window.commandInsideCommandIndex = window.maxCommandInsideCommandIndex;
									}
								}
								io.currentCommand = window.commandInsideCommandArray[window.commandInsideCommandIndex]; 
								io.print(io.currentCommand);
								currentCommandCursorPosition = io.currentCommand.length;
							}
						} else {
							// popup menu being displayed, change it:
							if (autocompleteOn) {
								if (autocompleteIndex < autocompleteList.length - 1) {
									autocompleteIndex += 1; 
									printAutocompleteString(autocompleteList[autocompleteIndex]);
								}													
								break;
							}
							if (window.commandIndex < window.maxCommandIndex) {
								var scrolledLines = window.promptScroll - term.scrollPort_.getTopRowIndex();
								io.print('\x1b[' + (window.promptLine + scrolledLines + 1) + ';' + (window.promptEnd + 1) + 'H'); // move cursor to position at start of line
								io.print('\x1b[0J'); // delete display after cursor
								if (string != String.fromCharCode(27) + "[1;3B") {
									window.commandIndex += 1;
								} else {
									window.commandIndex += 5;
									if (window.commandIndex >= window.maxCommandIndex) {
										window.commandIndex = window.maxCommandIndex;
									}
								}
								io.currentCommand = window.commandArray[window.commandIndex]; 
								io.print(io.currentCommand);
								currentCommandCursorPosition = io.currentCommand.length;
							}
						}
						break;
					case String.fromCharCode(27) + "[D":  // Left arrow
					case String.fromCharCode(2):  // Ctrl+B
						if (this.document_.getSelection().type == 'Range') {
							// move cursor to start of selection
							this.moveCursorPosition(term.scrollPort_.selection.startRow.rowIndex - term.scrollPort_.getTopRowIndex(), term.scrollPort_.selection.startOffset);
							this.document_.getSelection().collapseToStart();
							disableAutocompleteMenu();
						} else {
							disableAutocompleteMenu();
							if (currentCommandCursorPosition > 0) { 
								var currentChar = io.currentCommand[currentCommandCursorPosition - 1];
								var currentCharWidth = lib.wc.strWidth(currentChar);
								this.document_.getSelection().empty();
								for (var i = 0; i < currentCharWidth; i++) {
									io.print('\b'); // move cursor back n chars, across lines
								}
								currentCommandCursorPosition -= 1;
								this.document_.getSelection().empty();
							}
						}
						break;
					case String.fromCharCode(27) + "[C":  // Right arrow
					case String.fromCharCode(6):  // Ctrl+F
						if (this.document_.getSelection().type == 'Range') {
							// move cursor to end of selection
							this.moveCursorPosition(term.scrollPort_.selection.endRow.rowIndex - term.scrollPort_.getTopRowIndex(), term.scrollPort_.selection.endOffset);
							this.document_.getSelection().collapseToEnd();
							disableAutocompleteMenu();
						} else {
							// recompute complete menu? For now, disable it.
							disableAutocompleteMenu();
							if (currentCommandCursorPosition < io.currentCommand.length) {
								var currentChar = io.currentCommand[currentCommandCursorPosition];
								var currentCharWidth = lib.wc.strWidth(currentChar);
								this.document_.getSelection().empty();
								if (term.screen_.cursorPosition.column < term.screenSize.width - currentCharWidth) {
									io.print('\x1b[' + currentCharWidth + 'C'); // move cursor forward n chars
								} else {
									io.print('\x1b[' + (term.screen_.cursorPosition.row + 2) + ';' + 0 + 'H'); // move cursor to start of next line
								}
								currentCommandCursorPosition += 1;
								this.document_.getSelection().empty();
							}
						}
						break; 
					case String.fromCharCode(27) + "[1;3D":  // Alt-left arrow
						disableAutocompleteMenu();
						if (currentCommandCursorPosition > 0) { // prompt.length
							while (currentCommandCursorPosition > 0) {
								currentCommandCursorPosition -= 1;
								var currentChar = io.currentCommand[currentCommandCursorPosition];
								var currentCharWidth = lib.wc.strWidth(currentChar);
								for (var i = 0; i < currentCharWidth; i++) {
									io.print('\b'); // move cursor back n chars, across lines
								}
								if  (!isLetter(currentChar)) {
									break;
								}
							}
						}
						break;
					case String.fromCharCode(27) + "[1;3C":  // Alt-right arrow
						disableAutocompleteMenu();
						if (currentCommandCursorPosition < io.currentCommand.length) { // prompt.length
							while (currentCommandCursorPosition < io.currentCommand.length) {
								currentCommandCursorPosition += 1;
								var currentChar = io.currentCommand[currentCommandCursorPosition];
								var currentCharWidth = lib.wc.strWidth(currentChar);
								if (term.screen_.cursorPosition.column < term.screenSize.width - currentCharWidth) {
									io.print('\x1b[' + currentCharWidth + 'C'); // move cursor forward n chars
								} else {
									io.print('\x1b[' + (term.screen_.cursorPosition.row + 2) + ';' + 0 + 'H'); // move cursor to start of next line
								}
								if  (!isLetter(currentChar)) {
									break;
								}
							}
						}
						break;
					case String.fromCharCode(9):  // Tab, so autocomplete
						if (window.commandRunning == '') {
							if (autocompleteOn) {
								// hit tab when menu already visible = select current
								pickCurrentValue();
							} else {
								// Work on autocomplete list / current command
								updateAutocompleteMenu(io, currentCommandCursorPosition); 
							}
						} else {
							// no autocomplete inside running commands. Just print 4 spaces.
							// (spaces because tab confuse hterm)
							io.currentCommand = io.currentCommand.slice(0, currentCommandCursorPosition) + "    " + 
								io.currentCommand.slice(currentCommandCursorPosition, io.currentCommand.length);
							printString("    ");
							currentCommandCursorPosition += 4;
						}
						break;
					case String.fromCharCode(1):  // Ctrl-A: beginnging of line
						disableAutocompleteMenu();
						if (currentCommandCursorPosition > 0) { // prompt.length
							var scrolledLines = window.promptScroll - this.scrollPort_.getTopRowIndex();
							var topRowCommand = window.promptLine + scrolledLines;
							this.io.print('\x1b[' + (topRowCommand + 1) + ';' + (window.promptEnd + 1) + 'H'); // move cursor to new position 
							currentCommandCursorPosition = 0; 
						}
						break;
					case String.fromCharCode(3):  // Ctrl-C: cancel current command
						disableAutocompleteMenu();
						// Before *not*-executing command, move to end of line if not already there:
						// Compute how many lines should we move downward:
						var beginCommand = io.currentCommand.slice(0, currentCommandCursorPosition); 
						var lineCursor = Math.floor((lib.wc.strWidth(beginCommand) + window.promptEnd)/ term.screenSize.width);
						var lineEndCommand = Math.floor((lib.wc.strWidth(io.currentCommand) + window.promptEnd)/ term.screenSize.width);
						for (var i = 0; i < lineEndCommand - lineCursor; i++) {
							io.println('');
						}
						io.println('');
						printPrompt();
						updatePromptPosition(); 
						io.currentCommand = '';
						currentCommandCursorPosition = 0;
						if (window.commandRunning != '') {
							window.commandInsideCommandIndex = window.maxCommandInsideCommandIndex; 
						} else { 									
							window.commandIndex = window.maxCommandIndex
						}
						break;
					case String.fromCharCode(4):  // Ctrl-D: deleter character after cursor TODO: test
						disableAutocompleteMenu();
						if (currentCommandCursorPosition < io.currentCommand.length) {
							var currentChar = io.currentCommand[currentCommandCursorPosition];
							var currentCharWidth = lib.wc.strWidth(currentChar);
							io.print('\x1b[0J'); // delete display after cursor
							// print remainder of command line
							var endOfCommand = io.currentCommand.slice(currentCommandCursorPosition + 1, io.currentCommand.length);
							io.print(endOfCommand)
							// move cursor back to where it was (don't use term.screen_.cursorPosition):
							var wcwidth = lib.wc.strWidth(endOfCommand);
							for (var i = 0; i < wcwidth; i++) {
								io.print('\b'); 
							}
							// remove character from command at current position:
							io.currentCommand = io.currentCommand.slice(0, currentCommandCursorPosition) + 
								io.currentCommand.slice(currentCommandCursorPosition + 1, io.currentCommand.length); 
						}
						break;
					case String.fromCharCode(5):  // Ctrl-E: end of line
						disableAutocompleteMenu();
						if (currentCommandCursorPosition < io.currentCommand.length) {
							var scrolledLines = window.promptScroll - this.scrollPort_.getTopRowIndex();
							var topRowCommand = window.promptLine + scrolledLines;
							var fullLength = lib.wc.strWidth(io.currentCommand) + window.promptEnd; 
							var y = Math.floor((fullLength / this.screenSize.width)) ;
							var x = fullLength - this.screenSize.width * y;
							y += topRowCommand

							this.io.print('\x1b[' + (y + 1) + ';' + (x + 1) + 'H'); // move cursor to new position 
							currentCommandCursorPosition = io.currentCommand.length; 
						}
						break;
					case String.fromCharCode(11):  // Ctrl-K: kill until end of line
						disableAutocompleteMenu();
						if (currentCommandCursorPosition < io.currentCommand.length) { 
							io.currentCommand = io.currentCommand.slice(0, currentCommandCursorPosition)
							window.term_.io.print('\x1b[0J'); // delete display after cursor
						}
						break;
					case String.fromCharCode(21):  // Ctrl-U: kill from cursor to beginning of the line
						disableAutocompleteMenu();
						// clear entire line and move cursor to beginning of the line
						io.print('\x1b[2K\x1b[G');
						io.currentCommand = io.currentCommand
							.slice(currentCommandCursorPosition);
						currentCommandCursorPosition = 0;
						// redraw command line
						printPrompt();
						io.print(io.currentCommand);
						// move cursor back to beginning of the line
						io.print(`\x1b[${window.promptMessage.length + 1}G`);
						break;
					case String.fromCharCode(23):  // Ctrl+W: kill the word behind point
						disableAutocompleteMenu();
						deleteBackward();
						while (currentCommandCursorPosition > 0) {
							const currentChar = io.currentCommand[currentCommandCursorPosition - 1];
							if (!isLetter(currentChar)) {
								break;
							}
							deleteBackward();
						}
						break;
					case String.fromCharCode(12):  // Ctrl-L: clear screen
						disableAutocompleteMenu();
						// erase display, move cursor to (1,1)
						window.term_.io.print('\x1b[2J\x1b[1;1H');
						// redraw command:
						printPrompt();
						window.term_.io.print(io.currentCommand);
						var endOfCommand = io.currentCommand.slice(currentCommandCursorPosition, io.currentCommand.length);
						// move cursor back to where it was (don't use term.screen_.cursorPosition):
						var wcwidth = lib.wc.strWidth(endOfCommand);
						for (var i = 0; i < wcwidth; i++) {
							io.print('\b'); 
						}
						break;
					case String.fromCharCode(32): // Space: end auto-complete
						disableAutocompleteMenu(); 
					default:
						// window.webkit.messageHandlers.aShell.postMessage('onVTKeyStroke received ' + string);									
						// Remove all escape characters if we reach this point:
						// Also remove '\r' and ^D characters (when pasting):
						var newString = string.replaceAll(String.fromCharCode(27), '').replaceAll(String.fromCharCode(13), '').replaceAll(String.fromCharCode(4), '');
						// For debugging:
						// for (var i = 0; i < newString.length; i++) {
						// 	var charcode = newString.charCodeAt(i);
						// 	window.webkit.messageHandlers.aShell.postMessage("char " + i + " = " + charcode + " = " + newString[i]);
						// }
						// insert character at cursor position:
						if (this.document_.getSelection().type == 'Range') {
							term.onCut(null); // remove the selection without copying it
						}
						this.document_.getSelection().empty(); 
						printString(newString);  // print before we update io.currentCommand
						io.currentCommand = io.currentCommand.slice(0, currentCommandCursorPosition) + newString + 
							io.currentCommand.slice(currentCommandCursorPosition, io.currentCommand.length);
						currentCommandCursorPosition += newString.length;
						if (autocompleteOn) {
							updateAutocompleteMenu(io, currentCommandCursorPosition); 
						}
						break;
				}
			}
		};
		term.moveCursorPosition = function(y, x) {
			// If currentCommand is empty, update prompt position (JS is asynchronous, position might have been computed before the end of the scroll)
			if (io.currentCommand === '') { 
				updatePromptPosition(); 
			}
			var scrolledLines = window.promptScroll - this.scrollPort_.getTopRowIndex();
			var topRowCommand = window.promptLine + scrolledLines;
			// Don't move cursor outside of current line
			if (y < topRowCommand) { 
				return; 
			}
			// this.screen_.setCursorPosition(y, x);  // does not update blinking cursor position
			if (x < window.promptEnd) {
				return; 
				// x = window.promptEnd;
			}
			var deltay = this.screen_.cursorPosition.row - y;
			var deltax = this.screen_.cursorPosition.column - x;
			var deltaCursor = deltax + deltay * this.screenSize.width; // by how many *characters* should we move?
			if (currentCommandCursorPosition - deltaCursor > lib.wc.strWidth(io.currentCommand)) {
				// If we are after the end of the line, move to the end of the line.
				var overclick = currentCommandCursorPosition - deltaCursor - lib.wc.strWidth(io.currentCommand);
				deltaCursor += overclick;
				// At the end of the line, so move there.
				var fullLength = lib.wc.strWidth(io.currentCommand) + window.promptEnd; 
				var y = Math.floor((fullLength / this.screenSize.width)) ;
				var x = fullLength - this.screenSize.width * y;
				y += topRowCommand
			}
			// Now compute the new position inside the command line, taking into account multi-byte characters.
			// We assume characters have a width of at least 1, so we move of at least deltaCursor.
			var newCursorPosition = currentCommandCursorPosition - deltaCursor; 
			if (deltaCursor > 0) { 
				var string = io.currentCommand.slice(newCursorPosition, currentCommandCursorPosition);
				while (lib.wc.strWidth(string) > deltaCursor) {
					newCursorPosition += 1; 
					string = io.currentCommand.slice(newCursorPosition, currentCommandCursorPosition);
				}
			} else {
				var string = io.currentCommand.slice(currentCommandCursorPosition, newCursorPosition);
				while (lib.wc.strWidth(string) > -deltaCursor) {
					newCursorPosition -= 1; 
					string = io.currentCommand.slice(currentCommandCursorPosition, newCursorPosition);
				}
			}
			currentCommandCursorPosition = newCursorPosition;
			io.print('\x1b[' + (y + 1) + ';' + (x + 1) + 'H'); // move cursor to new position 
		};
		io.sendString = io.onVTKeystroke; // was io.print
		initContent(io);
		if ((window.printedContent === undefined) || (window.printedContent == "")) {
			printPrompt(); // first prompt
		} else {
			window.webkit.messageHandlers.aShell.postMessage('Restored terminal content from previous session');
			window.term_.io.print(window.printedContent);
		}
		updatePromptPosition(); 
		this.setCursorVisible(true);
		this.setCursorBlink(false);
		this.setFontSize(window.fontSize); 
		this.setFontFamily(window.fontFamily); 
		this.setForegroundColor(window.foregroundColor);
		this.setBackgroundColor(window.backgroundColor);
		this.setCursorColor(window.cursorColor);
		this.keyboard.characterEncoding = 'raw';
		// this.keyboard.bindings.addBinding('F11', 'PASS');
		// this.keyboard.bindings.addBinding('Ctrl-R', 'PASS');

	};
	term.decorate(document.querySelector('#terminal'));
	term.installKeyboard();
	// Useful for console debugging.
	window.term_ = term;
	console.log = println
	if (window.commandRunning === undefined) {
		window.commandRunning = '';
	}
	window.interactiveCommandRunning = isInteractive(window.commandRunning);
	if (window.commandArray === undefined) {
		window.commandArray = new Array();
		window.commandIndex = 0;
		window.maxCommandIndex = 0;
	}
	if (window.printedContent === undefined) {
		window.printedContent = '';
	}
	window.commandInsideCommandArray = new Array();
	window.commandInsideCommandIndex = 0;
	window.maxCommandInsideCommandIndex = 0;
	window.promptMessage = "$ "; // prompt for commands, configurable
	window.promptEnd = 2; // prompt for commands, configurable
	window.promptLine = 0; // term line on which the prompt started
	window.promptScroll = 0; // scroll line on which the scrollPort was when the prompt started
	if (window.voiceOver != undefined) {
		window.term_.setAccessibilityEnabled(window.voiceOver);
	}
	if ((window.commandToExecute != undefined) && (window.commandToExecute != "")) {
		window.webkit.messageHandlers.aShell.postMessage('shell:' + window.commandToExecute);
		window.commandRunning = window.commandToExecute;
		window.commandToExecute = ""; 
	}
}

window.onload = function() {
	lib.init(setupHterm);
};
