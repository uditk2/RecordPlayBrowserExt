# Browser Action Recorder Extension

This Chrome extension allows you to record and replay browser actions. It captures clicks, text input, form changes, and navigation between pages.

## Features

- Record browser actions including clicks, typing, and form interactions
- Play back recorded actions with the exact same timing and delays as the original recording
- Real-time progress tracking during playback
- Works across multiple tabs and pages
- Simple and intuitive user interface
- Persistent storage that maintains recordings even after browser restart

## Installation Instructions

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer Mode" (toggle in the top-right corner)
4. Click "Load unpacked" and select the extension directory
5. The extension icon should appear in your browser toolbar

## Usage

1. Click the extension icon to open the popup
2. Click "Record" to start recording your actions
3. Perform the actions you want to record (clicking, typing, etc.)
4. Click "Stop Recording" when finished
5. Click "Play" to replay the recorded actions

## Icon Creation

You'll need to create three icon sizes for the extension:
- icon16.png (16x16 pixels)
- icon48.png (48x48 pixels)
- icon128.png (128x128 pixels)

Place these icons in an `icons` folder within the extension directory.

## Limitations

- The extension works best on static websites. Dynamic websites with complex JavaScript may have unpredictable results.
- Some websites may block content scripts for security reasons, which can prevent the extension from working properly.
- The extension records actions based on element attributes and XPath. If the website structure changes, playback may fail.

## Troubleshooting

If playback doesn't work as expected:
- Make sure the starting webpage matches where you began recording
- Try recording a simpler sequence of actions
- Check if the website has security measures that block content scripts

## License

MIT License
