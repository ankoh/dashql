#!/usr/bin/env python3

import argparse
import xml.etree.ElementTree as ET

SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("inputs", nargs="+")
    args = parser.parse_args()

    out = ET.Element(f"{{{SVG_NS}}}svg")
    for path in args.inputs:
        tree = ET.parse(path)
        for sym in tree.iter(f"{{{SVG_NS}}}symbol"):
            out.append(sym)

    tree = ET.ElementTree(out)
    ET.indent(tree, space="", level=0)
    tree.write(args.output, encoding="utf-8", xml_declaration=False)

if __name__ == "__main__":
    main()
