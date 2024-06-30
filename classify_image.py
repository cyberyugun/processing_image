import tensorflow as tf
import tensorflow_hub as hub
import numpy as np
from PIL import Image
import sys
import os
import json  # Import the json module

# Explicitly set stdout encoding to UTF-8
if sys.stdout.encoding != 'UTF-8':
    sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)

def load_image(image_path, image_size=(299, 299)):
    try:
        img = Image.open(image_path).convert('RGB')
        img = img.resize(image_size, Image.NEAREST)
        img = np.array(img) / 255.0
        return img[np.newaxis, ...]
    except FileNotFoundError:
        print(f"Error: Image file not found at {image_path}")
        sys.exit(1)
    except Exception as e:
        print(f"Error loading image: {e}")
        sys.exit(1)

def classify_image(image_path):
    # model_url = "https://tfhub.dev/google/tf2-preview/mobilenet_v2/classification/4"
    # model_url = "https://tfhub.dev/google/imagenet/inception_v3/classification/5"
    model_url = "https://tfhub.dev/tensorflow/efficientnet/b0/classification/1"
    try:
        model = hub.KerasLayer(model_url)
    except Exception as e:
        print(f"Error: An error occurred loading the model: {e}")
        sys.exit(1)
    
    # Download labels file
    # labels_url = 'https://storage.googleapis.com/download.tensorflow.org/data/ImageNetLabels.txt'
    labels_url = 'https://storage.googleapis.com/download.tensorflow.org/data/imagenet_class_index.json'
    # labels_url = 'https://storage.googleapis.com/recipeguide-tfhub/food-101-labels.json'
    try:
        labels_path = tf.keras.utils.get_file(
            'imagenet_class_index.json',
            labels_url,
            cache_subdir='datasets',  # Optional cache directory
            extract=False  # Avoids extracting if file is already present
        )
    except Exception as e:
        print(f"Error downloading data from {labels_url}: {e}")
        sys.exit(1)

    try:
        with open(labels_path, 'r', encoding='utf-8') as f:
            labels_json = json.load(f)  # Load JSON data from file
            labels = [labels_json[str(i)][1] for i in range(len(labels_json))]
    except Exception as e:
        print(f"Error reading labels file: {e}")
        sys.exit(1)

    try:
        image = load_image(image_path)
        print(f"Loaded image shape: {image.shape}")  # Debug output
    except Exception as e:
        print(f"Error loading image: {e}")
        sys.exit(1)

    try:
        predictions = model(image)
        print(f"Predictions shape: {predictions.shape}")  # Debug output

        predicted_class = np.argmax(predictions[0], axis=-1)
        predicted_label = labels[predicted_class]
        confidence_score = predictions[0][predicted_class]
        
        # Print top 5 predictions
        top_k = 5
        top_indices = np.argsort(predictions[0])[-top_k:][::-1]
        print(f"\nTop {top_k} predictions:")
        for i, idx in enumerate(top_indices):
            print(f"{i+1}. {labels[idx]} (Confidence: {predictions[0][idx]:.2f})")

        return predicted_label, confidence_score

    except Exception as e:
        print(f"Error making predictions: {e}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python classify_image.py <image_path>")
        sys.exit(1)
    
    image_path = sys.argv[1]
    if not os.path.isfile(image_path):
        print(f"Error: Image file not found at {image_path}")
        sys.exit(1)
    
    try:
        label, confidence = classify_image(image_path)
        print(f"\nPredicted label: {label} (Confidence: {confidence:.2f})")
    except Exception as e:
        print(f"Error classifying image: {e}")
