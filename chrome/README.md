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

### For Development/Testing
1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" using the toggle in the top-right corner
4. Click "Load unpacked"
5. Navigate to and select the `chrome` directory
6. The extension icon should appear in your browser toolbar

### For Regular Use
Once the extension is published to the Chrome Web Store:
1. Visit the Chrome Web Store page for the extension
2. Click "Add to Chrome"
3. Review the permissions and click "Add extension"

## Usage

1. Click the extension icon to open the popup
2. Click "Record" to start recording your actions
3. Perform the actions you want to record (clicking, typing, etc.)
4. Click "Stop Recording" when finished
5. Click "Play" to replay the recorded actions

## Icon Creation

You'll need to create multiple icon sizes for the extension:
- icon16.png (16x16 pixels)
- icon32.png (32x32 pixels)
- icon48.png (48x48 pixels)
- icon64.png (64x64 pixels)
- icon96.png (96x96 pixels)
- icon128.png (128x128 pixels)

Place these icons in the `icons` folder within the extension directory.

## Limitations

- The extension works best on static websites. Dynamic websites with complex JavaScript may have unpredictable results.
- Some websites may block content scripts for security reasons, which can prevent the extension from working properly.
- The extension records actions based on element attributes and XPath. If the website structure changes, playback may fail.

## Troubleshooting

If playback doesn't work as expected:
- Make sure the starting webpage matches where you began recording
- Try recording a simpler sequence of actions
- Check if the website has security measures that block content scripts
- Verify the extension has the necessary permissions for the website

## License

MIT License