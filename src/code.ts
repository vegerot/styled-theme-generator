import TinyColor from "tinycolor2";
import merge from "./utils/deepmerge";

/**
 * Loops through a nested object to set the last objects param or value
 *
 * @param obj
 * @param newValue
 * @param isKey
 */
function walkObject(obj: object, newValue: string, isKey: boolean = false) {
  const keys = Object.keys(obj);

  // If it's the top level, create first param
  if (keys.length === 0) {
    obj[newValue] = {};
  }

  // Loop through objects parameters
  keys.forEach(function (key, i) {
    // Only do the first for perf reasons
    if (i === 0) {
      let value = obj[key];

      // If it's an object, recursively run again
      const nestedKeys = Object.keys(value);
      if (typeof value === "object" && nestedKeys.length > 0) {
        walkObject(value, newValue, isKey);
      } else {
        // Set param or value of nested object
        if (isKey) {
          obj[key][newValue] = {};
        } else {
          obj[key] = newValue;
        }
      }
    }
  });

  return obj;
}

/**
 * Describes a Figma paint type retrieved from the Figma API.
 * @ignore
 */
const enum FigmaPaintType {
  Solid = "SOLID",
  GradientLinear = "GRADIENT_LINEAR",
}

type FigmaPaint = SolidPaint | GradientPaint | { type: unknown };

const isFigmaLinearGradient = (paint: FigmaPaint): paint is GradientPaint => {
  return paint.type === FigmaPaintType.GradientLinear;
};

const isFigmaSolid = (paint: FigmaPaint): paint is SolidPaint => {
  return paint.type === FigmaPaintType.Solid;
};

// This shows the HTML page in "ui.html".
figma.showUI(__html__);

// Calls to "parent.postMessage" from within the HTML page will trigger this
// callback. The callback will be passed the "pluginMessage" property of the
// posted message.
figma.ui.onmessage = async (msg) => {
  // One way of distinguishing between different types of messages sent from
  // your HTML page is to use an object with a "type" property like this.
  if (msg.type === "generate") {
    let theme: { text: { [x: string]: any; }; fonts: { [x: string]: any; }; colors: any; };
    try {
      theme = JSON.parse(msg.theme);
    } catch (e) {
      console.error("JSON parse failed", e);
    }
    // @TODO: Parse JSON and generate text and color styles
    const localTextStyles = figma.getLocalTextStyles();

    // if (!theme) return;

    // Parse text styles
    if (theme.text) {
      Object.keys(theme.text)?.map(async (name) => {
        const themeFont = theme.text[name];
        const localStyle = localTextStyles.find(
          ({ name: localName }) => localName === name
        );
        const textStyle = localStyle || figma.createTextStyle();
        const fontName = {
          family: theme.fonts[themeFont.fontFamily],
          style: themeFont.fontStyle ? themeFont.fontStyle : "Regular",
        };

        textStyle.name = name;
        // Load font
        await figma.loadFontAsync(fontName);
        textStyle.fontName = fontName;
        textStyle.fontSize = themeFont.fontSize;
        textStyle.letterSpacing = themeFont.letterSpacing;
        textStyle.lineHeight = themeFont.lineHeight;
        textStyle.textCase = themeFont.textTransform;
        textStyle.textDecoration = themeFont.textDecoration;
      });
    }

    const localColorStyles = figma.getLocalPaintStyles();

    function createFigmaColorStyle(themeObject: { [x: string]: any; }) {
      Object.keys(themeObject)?.map((name) => {
        const themeColor = themeObject[name];

        // check if has nested colors
        if (typeof themeColor === "object") {
          const colorKeys = Object.keys(themeColor);
          return colorKeys.forEach((objProperty) => {
            const nestedKeys = Object.keys(objProperty);
            if (typeof objProperty === "object" && nestedKeys?.length > 0)
              return createFigmaColorStyle(themeColor);
          });
        } else {
          const localStyle = localColorStyles.find(
            ({ name: localName }) => localName === name
          );
          const colorStyle: PaintStyle = localStyle || figma.createPaintStyle();
          colorStyle.name = name;

          const oColor = TinyColor(themeColor);
          if (!oColor.isValid()) {
            throw new Error('invalid color' + oColor.getOriginalInput())
          }
          const convertedColor = oColor.toRgb()
          const { r, g, b, a } = convertedColor;
          const color: RGB = {
            r: r / 255,
            g: g / 255,
            b: b / 255,
          };

          const paintStyle: SolidPaint = {
            type: "SOLID",
            color,
            opacity: a,
          };
          colorStyle.paints = [paintStyle];
        }
      });
    }

    // Parse color styles
    if (theme.colors) {
      createFigmaColorStyle(theme.colors);
    }
  }

  if (msg.type === "copy") {
    // Input flags to change parsing
    // e.g. we can change color from RGB to HEX
    const flagColorType: string = "hex";
    const flagLowercaseNames = true;

    // Get text styles to generate text variants
    const textStyles = figma.getLocalTextStyles();

    // Parse font sizes
    // Create array of font sizes and sort numerically by least to most
    const fontSizesWithDupes = textStyles
      .map(({ fontSize }) => fontSize)
      .sort((a, b) => a - b);
    // Remove dupes
    const fontSizes = fontSizesWithDupes.filter(
      (item, index) => fontSizesWithDupes.indexOf(item) == index
    );

    // Parse font families
    // Create array of font sizes and sort numerically by least to most
    const fontFamilies = textStyles
      .map(({ fontName }) => fontName!.family)
      .sort()
      .reduce((map, obj) => {
        map[obj.toLowerCase()] = obj;
        return map;
      }, {});

    // Grab index of font size
    function getFontSize(fontSize: number) {
      let fontIndex: string | number;
      fontSizes.filter((fontSizeValue, index) => {
        if (fontSizeValue === fontSize) fontIndex = index;
      });
      return parseInt(fontIndex as string);
    }

    // Parse text variants
    const textVariants = textStyles
      .map(
        ({
          name,
          fontName,
          fontSize,
          letterSpacing,
          lineHeight,
          textCase,
          textDecoration,
        }) => ({
          name,
          fontFamily: `${fontName!.family.toLowerCase()}`,
          fontWeight: fontName.style,
          fontSize: getFontSize(fontSize),
          letterSpacing,
          lineHeight,
          textCase,
          textDecoration,
        })
      )
      .reduce((map, obj) => {
        map[obj.name.replace("/", ".").toLowerCase()] = obj;
        return map;
      }, {});

    // Get colors
    const colors = figma.getLocalPaintStyles();

    // Create container for parsed colors
    let finalColors = {};

    // Loop through colors and convert Figma API to theme/CSS format
    colors.map(({ paints, name }) => {
      // Parse name from Figma slash `/` to object `.`
      let filteredName = name;
      if (flagLowercaseNames) filteredName = filteredName.toLowerCase();
      const colorArray = filteredName.split("/");

      const colorNameReducer = (accumulator: object, currentValue: string, index: number) => {
        if (index == colorArray.length) {
          return walkObject(accumulator, "");
        }
        return walkObject(accumulator, currentValue, true);
      };
      let colorObject = colorArray.reduce(colorNameReducer, {});

      // Parse Figma Paint API to CSS color properties
      paints?.forEach((paint) => {
        if (isFigmaLinearGradient(paint)) {
          // @TODO: Add to gradient section
          // @TODO: Maybe do this last and then use color values if possible?
        }
        if (isFigmaSolid(paint)) {
          // Add to colors section
          const { r, g, b } = paint.color;
          let newColor = `rgba (${Math.round(r * 255)}, ${Math.round(
            g * 255
          )}, ${Math.round(b * 255)}, ${paint.opacity})`;
          // Convert optionally to other values
          switch (flagColorType) {
            case "hex":
              newColor = TinyColor(newColor).toHexString();
              break;
            case "rgba":
              newColor = TinyColor(newColor).toRgbString();
              break;
            case "hsl":
              newColor = TinyColor(newColor).toHslString();
              break;
            default:
              newColor = TinyColor(newColor).toHexString();
              break;
          }
          // Add to last nested object parameter
          colorObject = walkObject(colorObject, newColor);
        }

        // Use deep merge to combine current color with all colors
        finalColors = merge(finalColors, colorObject);
      });
    });

    const theme = {
      fontSizes,
      fonts: fontFamilies,
      text: textVariants,
      colors: finalColors,
    };

    figma.ui.postMessage(JSON.stringify(theme, null, 2));
  }

  // Make sure to close the plugin when you're done. Otherwise the plugin will
  // keep running, which shows the cancel button at the bottom of the screen.
  // figma.closePlugin();
};
