import cv2
import numpy as np
import sys
import os

def remove_background(input_image_path, output_image_path):
    # Read the input image
    myimage = cv2.imread(input_image_path, cv2.IMREAD_COLOR)
    if myimage is None:
        print(f"Error: Unable to read image {input_image_path}")
        sys.exit(1)
    
    # BG Remover 3
    myimage_hsv = cv2.cvtColor(myimage, cv2.COLOR_BGR2HLS)
     
    # Take S and remove any value that is less than half
    s = myimage_hsv[:,:,1]
    s = np.where(s < 132, 0, 1)  # Any value below 132 will be excluded
 
    # We increase the brightness of the image and then mod by 255
    v = (myimage_hsv[:,:,2] + 60) % 255
    v = np.where(v > 60, 1, 0)  # Any value above 70 will be part of our mask
 
    # Combine our two masks based on S and V into a single "Foreground"
    foreground = np.where(s + v > 0, 1, 0).astype(np.uint8)  # Casting back into 8-bit integer

    # Create a 4-channel image (RGBA)
    b, g, r = cv2.split(myimage)
    alpha = np.where(foreground == 0, 0, 255).astype(np.uint8)
    
    rgba = cv2.merge([b, g, r, alpha])
    
    # Save the output image
    cv2.imwrite(output_image_path, rgba)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python background_removal.py <input_image_path> <output_image_path>")
        sys.exit(1)
    
    input_image_path = sys.argv[1]
    output_image_path = sys.argv[2]

    # Ensure the input image path exists
    if not os.path.exists(input_image_path):
        print(f"Error: {input_image_path} does not exist.")
        sys.exit(1)

    # Ensure the output directory exists
    output_dir = os.path.dirname(output_image_path)
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    remove_background(input_image_path, output_image_path)
