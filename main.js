const inputLog = document.getElementById('inputLog');
const fileInput = document.getElementById('fileInput');
const downloadButton = document.getElementById('downloadButton');
const filterService0109Checkbox = document.getElementById('filterService0109');

// Handle file upload
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        try {
            const text = await file.text();
            inputLog.value = text;
            processLog();
        } catch (err) {
            console.error('Error reading file:', err);
            alert('Error reading file. Please try again.');
        }
    }
});

// Handle paste and input events
inputLog.addEventListener('input', () => {
    processLog();
});

// Handle download button click
downloadButton.addEventListener('click', () => {
    const outputText = document.getElementById("outputLog").value;
    if (outputText) {
        const blob = new Blob([outputText], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'formatted_log.txt';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }
});

filterService0109Checkbox.addEventListener('change', () => {
    processLog();
});

function getCommandType(command) {
    const baseCommand = command.replace(/[0-9A-Fa-f]+(?:OFF|ON|SV[0-9A-Fa-f]+)?$/, '');
    return baseCommand;
}

function normalizeCommand(originalCommand) {
    const command = originalCommand.substring(1);
    const filterService0109 = filterService0109Checkbox.checked;
    
    if (command.startsWith('01') && command.length === 4) {
        return filterService0109 ? '' : '>' + command.substring(0, 4);
    } else if (command.startsWith('09') && command.length === 4) {
        return filterService0109 ? '' : '>' + command.substring(0, 4);
    } else if (command.startsWith('21') && command.length === 4) {
        return '>' + command.substring(0, 4);
    } else if (command.startsWith('22') && command.length === 6) {
        return '>' + command.substring(0, 6);
    }
    return '';
}

function generateOBDbConfig(atCommands, command) {
    const config = {
    };
    
    // Split atCommands by space and process each command
    for (const cmd of atCommands.split(' ')) {
        const cmdStr = cmd.substring(1);  // Remove '>' prefix
        
        if (cmdStr.startsWith('ATSH')) {
            config['hdr'] = cmdStr.substring(4);
        } else if (cmdStr.startsWith('ATTA')) {
            config['tst'] = cmdStr.substring(4);
        } else if (cmdStr.startsWith('ATCEA') && cmdStr !== 'ATCEA') {
            config['eax'] = cmdStr.substring(5);
        } else if (cmdStr.startsWith('ATCRA')) {
            config['rax'] = cmdStr.substring(5);
        } else if (cmdStr.startsWith('ATST')) {
            config['tmo'] = cmdStr.substring(4);
        }
    }
    
    // Parse the main command
    const cmdStr = command.substring(1);  // Remove '>' prefix
    if (cmdStr.startsWith('22')) {
        config.cmd = { "22": cmdStr.substring(2) };
    } else if (cmdStr.startsWith('21')) {
        config.cmd = { "21": cmdStr.substring(2) };
    }
    
    return JSON.stringify(config);
}

function processLog() {
    const inputText = document.getElementById("inputLog").value;
    const lines = inputText.split(/\r?\n/);
    const vinGroups = new Map(); // Map<VIN, Map<commandKey, commandResponsePairs[]>>
    let currentVIN = "";
    let currentCommand = "";
    let currentResponses = [];
    let atCommands = new Map();
    let commandResponses = new Map(); // Map<commandKey, commandResponsePairs[]>
    
    lines.forEach(line => {
        line = line.trim();
        if (!line) return;
        
        if (/^(?:0[19]|21|22)[0-9A-F]{2,4}$/i.test(line)) return;
        // If string contains any non-hex characters and isn't an AT-prefixed command, ignore it.
        if (!line.startsWith('>AT') && /[^>0-9A-Fa-f]/.test(line)) return;

        // Ignore responses that are missing headers.
        if (!line.startsWith('>') && line.length < '7E803410D23'.length) return;
        if (line.startsWith('419')) return;
        if (!line.startsWith('>') && line.length % 2 != 1) return;  // Responses should always have an odd number of bytes.

        if (line === 'ATZ' || line === '>ATZ' || line === 'ATD' || line === '>ATD' ) {
            atCommands = new Map();
        } else if (line.startsWith('>')) {
            if (line.length == 1) { return; }
            if (currentCommand && !currentCommand.startsWith('>AT')) {
                if (currentVIN) {
                    const latestATCommands = [...atCommands.values()]
                        .filter(cmd => !cmd.includes('ATRV'))
                        .sort();
                    const normalizedCommand = normalizeCommand(currentCommand);
                    if (normalizedCommand) {
                        const commandKey = `${latestATCommands.join(' ')}\n${normalizedCommand}`.trim();
                        const responseGroup = [...currentResponses];
                        
                        if (!commandResponses.has(commandKey)) {
                            commandResponses.set(commandKey, []);
                        }
                        
                        const commandResponsePair = {
                            originalCommand: normalizedCommand,
                            responses: responseGroup
                        };
                        
                        const existingGroups = commandResponses.get(commandKey);
                        if (!existingGroups.some(group => 
                            group.responses.length === responseGroup.length && 
                            group.responses.every((resp, idx) => resp === responseGroup[idx])
                        )) {
                            existingGroups.push(commandResponsePair);
                        }
                    }
                }
            }
            
            if (line.startsWith('>AT')) {
                const atCommand = line.substring(1);
                const commandType = getCommandType(atCommand);
                atCommands.set(commandType, line);
            } else {
                if (line === '>0902') {
                    // Starting a new VIN section, let's commit all of the current responses to the current vin.
                    if (currentVIN) {
                        if (!vinGroups.has(currentVIN)) {
                            vinGroups.set(currentVIN, new Map());
                        }
                        const vinCommands = vinGroups.get(currentVIN);
                        // Merge commandResponses with vinCommands, adding commandResponsesPairs to existing commandKeys if they already exist, or adding them if not.
                        for (const [commandKey, commandResponsePairs] of commandResponses.entries()) {
                            const existingGroups = vinCommands.get(commandKey);
                            if (existingGroups) {
                                for (const commandResponsePair of commandResponsePairs) {
                                    if (!existingGroups.some(group => 
                                        group.responses.length === commandResponsePair.responses.length && 
                                        group.responses.every((resp, idx) => resp === commandResponsePair.responses[idx])
                                    )) {
                                        existingGroups.push(commandResponsePair);
                                    }
                                }
                            } else {
                                vinCommands.set(commandKey, commandResponsePairs);
                            }
                        }
                    }
                    currentVIN = "";
                    commandResponses = new Map(); // Map<commandKey, commandResponsePairs[]>
                }
                currentCommand = line;
                currentResponses = [];
            }
        } else {
            currentResponses.push(line);
            if (currentCommand === '>0902') {
                currentVIN += (currentVIN ? '\n' : '') + line;
            }
        }
    });
    
    if (currentCommand && !currentCommand.startsWith('>AT')) {
        if (currentVIN) {
            const latestATCommands = [...atCommands.values()]
                .filter(cmd => !cmd.includes('ATRV'))
                .sort();
            const normalizedCommand = normalizeCommand(currentCommand);
            if (normalizedCommand) {
                const commandKey = `${latestATCommands.join(' ')}\n${normalizedCommand}`.trim();
                const responseGroup = [...currentResponses];
                
                if (!commandResponses.has(commandKey)) {
                    commandResponses.set(commandKey, []);
                }
                
                const commandResponsePair = {
                    originalCommand: normalizedCommand,
                    responses: responseGroup
                };
                
                const existingGroups = commandResponses.get(commandKey);
                if (!existingGroups.some(group => 
                    group.responses.length === responseGroup.length && 
                    group.responses.every((resp, idx) => resp === responseGroup[idx])
                )) {
                    existingGroups.push(commandResponsePair);
                }
            }
        }
    }

    if (currentVIN) {
        if (!vinGroups.has(currentVIN)) {
            vinGroups.set(currentVIN, new Map());
        }
        const vinCommands = vinGroups.get(currentVIN);
        // Merge commandResponses with vinCommands, adding commandResponsesPairs to existing commandKeys if they already exist, or adding them if not.
        for (const [commandKey, commandResponsePairs] of commandResponses.entries()) {
            const existingGroups = vinCommands.get(commandKey);
            if (existingGroups) {
                for (const commandResponsePair of commandResponsePairs) {
                    if (!existingGroups.some(group => 
                        group.responses.length === commandResponsePair.responses.length && 
                        group.responses.every((resp, idx) => resp === commandResponsePair.responses[idx])
                    )) {
                        existingGroups.push(commandResponsePair);
                    }
                }
            } else {
                vinCommands.set(commandKey, commandResponsePairs);
            }
        }
    }

    let output = '';
    // For each vin in vinGroups:
    for (const [vin, commands] of vinGroups.entries()) {
        output += '\n\n#-------------------------------------\n# VIN\n' + vin + '\n\n';

        [...commands.entries()].sort((a, b) => {
            const lastLineA = a[0].split('\n').pop();
            const lastLineB = b[0].split('\n').pop();
            return lastLineA.localeCompare(lastLineB);
        }).forEach(([cmd, groups]) => {
            output += `${cmd}\n`;
            
            // Generate OBDb configuration
            let atCommands = '';
            cmd.split('\n').forEach(line => {
                if (line.startsWith('>AT')) {
                    atCommands = line;
                }
            });
            
            const lastCommand = cmd.split('\n').pop();
            if (lastCommand && (lastCommand.startsWith('>22') || lastCommand.startsWith('>21'))) {
                output += generateOBDbConfig(atCommands, lastCommand) + '\n';
            }
            
            groups.forEach((group, idx) => {
                if (group.originalCommand !== normalizeCommand(group.originalCommand)) {
                    output += `${group.originalCommand}\n`;
                }
                output += group.responses.join('\n');
                if (idx < groups.length - 1) {
                    output += '\n\n';
                }
            });
            output += '\n\n';
        });
    }
    
    const outputText = output.trim();
    document.getElementById("outputLog").value = outputText;
    
    // Show/hide download button based on whether there's output
    downloadButton.style.display = outputText ? 'block' : 'none';
}