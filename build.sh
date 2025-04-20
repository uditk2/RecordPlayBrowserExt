#!/bin/bash

# Remove any existing plugin.zip file
rm -f plugin.zip

# Make sure the icons directory exists
if [ ! -d "icons" ]; then
  echo "Error: icons directory not found!"
  exit 1
fi

# Check for required files
required_files=("manifest.json" "background.js" "content.js" "popup/popup.html" "popup/popup.js" "icons/icon-48.png" "icons/icon-96.png")
for file in "${required_files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "Error: Required file $file not found!"
    exit 1
  fi
done

# Create a new zip file excluding unnecessary files and directories
zip -r plugin.zip . -x "*.git*" "build.sh" "plugin.zip" "*.DS_Store" ".gitignore"

echo "Plugin zipped successfully as plugin.zip"
echo "You can now install this in Firefox by going to about:debugging"
echo "Click 'This Firefox' and then 'Load Temporary Add-on...'"
echo "Select the plugin.zip file"