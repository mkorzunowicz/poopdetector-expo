// EfficientDet COCO Labels - 1-indexed as used by Google's EfficientDet models
// Based on https://github.com/google/automl/blob/main/efficientdet/tf2/label_util.py

export const EFFICIENTDET_LABELS: { [key: number]: string } = {
  0: 'background', // Class 0 is reserved for background
  1: 'person',
  2: 'bicycle',
  3: 'car',
  4: 'motorcycle',
  5: 'airplane',
  6: 'bus',
  7: 'train',
  8: 'truck',
  9: 'boat',
  10: 'traffic light',
  11: 'fire hydrant',
  13: 'stop sign',
  14: 'parking meter',
  15: 'bench',
  16: 'bird',
  17: 'cat',
  18: 'dog',
  19: 'horse',
  20: 'sheep',
  21: 'cow',
  22: 'elephant',
  23: 'bear',
  24: 'zebra',
  25: 'giraffe',
  27: 'backpack',
  28: 'umbrella',
  31: 'handbag',
  32: 'tie',
  33: 'suitcase',
  34: 'frisbee',
  35: 'skis',
  36: 'snowboard',
  37: 'sports ball',
  38: 'kite',
  39: 'baseball bat',
  40: 'baseball glove',
  41: 'skateboard',
  42: 'surfboard',
  43: 'tennis racket',
  44: 'bottle',
  46: 'wine glass',
  47: 'cup',
  48: 'fork',
  49: 'knife',
  50: 'spoon',
  51: 'bowl',
  52: 'banana',
  53: 'apple',
  54: 'sandwich',
  55: 'orange',
  56: 'broccoli',
  57: 'carrot',
  58: 'hot dog',
  59: 'pizza',
  60: 'donut',
  61: 'cake',
  62: 'chair',
  63: 'couch',
  64: 'potted plant',
  65: 'bed',
  67: 'dining table',
  70: 'toilet',
  72: 'tv',
  73: 'laptop',
  74: 'mouse',
  75: 'remote',
  76: 'keyboard',
  77: 'cell phone',
  78: 'microwave',
  79: 'oven',
  80: 'toaster',
  81: 'sink',
  82: 'refrigerator',
  84: 'book',
  85: 'clock',
  86: 'vase',
  87: 'scissors',
  88: 'teddy bear',
  89: 'hair drier',
  90: 'toothbrush',
};

// Convert to array format with fallback for missing indices
export const EFFICIENTDET_LABELS_ARRAY: string[] = [];
for (let i = 0; i <= 90; i++) {
  EFFICIENTDET_LABELS_ARRAY[i] = EFFICIENTDET_LABELS[i] || `class_${i}`;
}

// Color mapping for EfficientDet classes (same as COCO but adjusted for 1-indexing)
export const EFFICIENTDET_COLORS: { [key: number]: string } = {
  0: '#808080', // background - gray
  1: '#FF0000', // person - red
  2: '#00FF00', // bicycle - green
  3: '#0000FF', // car - blue
  4: '#FFFF00', // motorcycle - yellow
  5: '#FF00FF', // airplane - magenta
  6: '#00FFFF', // bus - cyan
  7: '#FFA500', // train - orange
  8: '#800080', // truck - purple
  9: '#FFC0CB', // boat - pink
  10: '#A52A2A', // traffic light - brown
  11: '#808000', // fire hydrant - olive
  13: '#90EE90', // stop sign - light green
  14: '#FFB6C1', // parking meter - light pink
  15: '#40E0D0', // bench - turquoise
  16: '#FF6347', // bird - tomato
  17: '#DA70D6', // cat - orchid
  18: '#32CD32', // dog - lime green
  19: '#FF1493', // horse - deep pink
  20: '#8A2BE2', // sheep - blue violet
  21: '#DEB887', // cow - burlywood
  22: '#D2691E', // elephant - chocolate
  23: '#B22222', // bear - fire brick
  24: '#F0E68C', // zebra - khaki
  25: '#FFD700', // giraffe - gold
  27: '#DC143C', // backpack - crimson
  28: '#4169E1', // umbrella - royal blue
  31: '#FF69B4', // handbag - hot pink
  32: '#2E8B57', // tie - sea green
  33: '#9932CC', // suitcase - dark orchid
  34: '#FF4500', // frisbee - orange red
  35: '#1E90FF', // skis - dodger blue
  36: '#CD853F', // snowboard - peru
  37: '#FF8C00', // sports ball - dark orange
  38: '#6495ED', // kite - cornflower blue
  39: '#20B2AA', // baseball bat - light sea green
  40: '#87CEEB', // baseball glove - sky blue
  41: '#98FB98', // skateboard - pale green
  42: '#F0F8FF', // surfboard - alice blue
  43: '#FFEFD5', // tennis racket - papaya whip
  44: '#FFDAB9', // bottle - peach puff
  46: '#E6E6FA', // wine glass - lavender
  47: '#FFF8DC', // cup - cornsilk
  48: '#B0C4DE', // fork - light steel blue
  49: '#FFFFE0', // knife - light yellow
  50: '#F5DEB3', // spoon - wheat
  51: '#DDA0DD', // bowl - plum
  52: '#87CEFA', // banana - light sky blue
  53: '#98FB98', // apple - pale green
  54: '#F5F5DC', // sandwich - beige
  55: '#FFE4B5', // orange - moccasin
  56: '#ADFF2F', // broccoli - green yellow
  57: '#FF7F50', // carrot - coral
  58: '#D2B48C', // hot dog - tan
  59: '#FA8072', // pizza - salmon
  60: '#F4A460', // donut - sandy brown
  61: '#BC8F8F', // cake - rosy brown
  62: '#CD5C5C', // chair - indian red
  63: '#4682B4', // couch - steel blue
  64: '#9ACD32', // potted plant - yellow green
  65: '#F08080', // bed - light coral
  67: '#20B2AA', // dining table - light sea green
  70: '#87CEEB', // toilet - sky blue
  72: '#778899', // tv - light slate gray
  73: '#B0C4DE', // laptop - light steel blue
  74: '#E0E0E0', // mouse - light gray
  75: '#FA8072', // remote - salmon
  76: '#F0E68C', // keyboard - khaki
  77: '#DDA0DD', // cell phone - plum
  78: '#EE82EE', // microwave - violet
  79: '#FF6347', // oven - tomato
  80: '#40E0D0', // toaster - turquoise
  81: '#AFEEEE', // sink - pale turquoise
  82: '#D3D3D3', // refrigerator - light gray
  84: '#F5DEB3', // book - wheat
  85: '#FFE4E1', // clock - misty rose
  86: '#FFC0CB', // vase - pink
  87: '#C0C0C0', // scissors - silver
  88: '#DEB887', // teddy bear - burlywood
  89: '#D2691E', // hair drier - chocolate
  90: '#F0F8FF', // toothbrush - alice blue
};

// Convert to array format with fallback colors
export const EFFICIENTDET_COLORS_ARRAY: string[] = [];
for (let i = 0; i <= 90; i++) {
  EFFICIENTDET_COLORS_ARRAY[i] = EFFICIENTDET_COLORS[i] || '#FFFFFF';
}