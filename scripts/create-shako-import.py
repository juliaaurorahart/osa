#!/usr/bin/env python3
"""Create the one-time OSA JSON bridge for the Shako instruction files.

The source Office files are ZIP/XML documents, so this intentionally uses only
Python's standard library. It preserves source text and provenance, but leaves
blank instruction steps blank for the author to complete in OSA.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET
from zipfile import ZipFile

SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
PRESENTATION_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"

# Faithful visual-area renders captured from the source PowerPoint. Each is
# imported as a first-class OSA Visual node, rather than a raw image string on
# an instruction card. The current Assembly View also receives a small
# compatibility locator until it reads the operation-source-visual relation
# directly.
INSTRUCTION_VISUALS_BY_SLIDE = {
    2: {
        "url": "/import-assets/shako-light-wrap/operation-01-slide.png",
        "alt": (
            "Full source slide for the Connector Box Drill, including its "
            "criteria, tools, exit condition, and color-coded drilling diagram."
        ),
    },
    3: {
        "url": "/import-assets/shako-light-wrap/operation-03-slide.png",
        "alt": (
            "Full source slide for Boost Attach V-out Wires, including its "
            "criteria, tools, exit condition, and wiring diagram."
        ),
    },
    4: {
        "url": "/import-assets/shako-light-wrap/operation-04-slide.png",
        "alt": (
            "Full source slide for Power Section, including its criteria, "
            "tools, exit condition, and wiring diagram."
        ),
    },
}

# These cropped diagrams are compatibility image assets attached directly to
# their imported project objects. New work creates a canonical Visual node and
# links the object to it through `object-visual`; these legacy assets remain so
# older boards and the current assembly view can continue to render.
OBJECT_VISUALS_BY_ID = {
    "part-connector-box-drilled": {
        "url": "/import-assets/shako-light-wrap/operation-01.png",
        "alt": (
            "Drilling diagram for the Connector Box Drilled work-state, "
            "showing the top, bottom, and side hole locations."
        ),
    },
    "part-boost-with-v-out-wires": {
        "url": "/import-assets/shako-light-wrap/operation-03.png",
        "alt": (
            "Diagram of the Boost with V-out Wires work-state, showing the "
            "attached red and black output wires."
        ),
    },
    "assembly-power-section": {
        "url": "/import-assets/shako-light-wrap/operation-04.png",
        "alt": (
            "Diagram of the completed Power Section Assembly, including the "
            "battery holder, boost board, cable relief mounts, and wiring."
        ),
    },
}


@dataclass(frozen=True)
class Cell:
    value: str = ""
    hyperlink: str = ""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def column_name(reference: str) -> str:
    return re.match(r"[A-Z]+", reference).group(0)  # type: ignore[union-attr]


def number_text(value: str, *, money: bool = False) -> str:
    if not value.strip():
        return ""
    try:
        number = Decimal(value)
    except InvalidOperation:
        return value
    if money:
        return f"{number.quantize(Decimal('0.01')):.2f}"
    normalized = format(number.normalize(), "f")
    return normalized.rstrip("0").rstrip(".") if "." in normalized else normalized


def workbook_rows(path: Path, sheet_name: str) -> dict[int, dict[str, Cell]]:
    ns = {"m": SHEET_NS, "r": OFFICE_REL_NS, "pr": PACKAGE_REL_NS}
    with ZipFile(path) as archive:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = [
                "".join(text.text or "" for text in item.iterfind(".//m:t", ns))
                for item in root.findall("m:si", ns)
            ]

        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        workbook_rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {relation.attrib["Id"]: relation.attrib["Target"] for relation in workbook_rels}
        sheet_path = ""
        sheets = workbook.find("m:sheets", ns)
        for sheet in list(sheets) if sheets is not None else []:
            if sheet.attrib.get("name") != sheet_name:
                continue
            relation_id = sheet.attrib[f"{{{OFFICE_REL_NS}}}id"]
            target = targets[relation_id]
            sheet_path = target.lstrip("/")
            if not sheet_path.startswith("xl/"):
                sheet_path = f"xl/{sheet_path}"
            sheet_path = re.sub(r"^xl/worksheets/\.\./", "xl/", sheet_path)
            break
        if not sheet_path:
            raise ValueError(f"Workbook does not contain sheet {sheet_name!r}.")

        sheet_root = ET.fromstring(archive.read(sheet_path))
        relationship_path = (
            f"{sheet_path.rsplit('/', 1)[0]}/_rels/"
            f"{sheet_path.rsplit('/', 1)[1]}.rels"
        )
        hyperlink_targets: dict[str, str] = {}
        if relationship_path in archive.namelist():
            relationship_root = ET.fromstring(archive.read(relationship_path))
            hyperlink_targets = {
                relation.attrib["Id"]: relation.attrib.get("Target", "")
                for relation in relationship_root
            }
        hyperlinks = {
            hyperlink.attrib["ref"]: hyperlink_targets.get(
                hyperlink.attrib.get(f"{{{OFFICE_REL_NS}}}id", ""),
                "",
            )
            for hyperlink in sheet_root.findall(".//m:hyperlink", ns)
        }

        result: dict[int, dict[str, Cell]] = {}
        for row in sheet_root.findall(".//m:sheetData/m:row", ns):
            row_number = int(row.attrib["r"])
            values: dict[str, Cell] = {}
            for element in row.findall("m:c", ns):
                reference = element.attrib["r"]
                kind = element.attrib.get("t")
                value_element = element.find("m:v", ns)
                raw = value_element.text if value_element is not None and value_element.text else ""
                if kind == "s" and raw:
                    value = shared[int(raw)]
                elif kind == "inlineStr":
                    value = "".join(
                        text.text or ""
                        for text in element.iterfind(".//m:t", ns)
                    )
                else:
                    value = raw
                values[column_name(reference)] = Cell(value, hyperlinks.get(reference, ""))
            result[row_number] = values
        return result


def slide_paragraphs(path: Path) -> list[dict[str, list[tuple[int, str]]]]:
    ns = {"p": PRESENTATION_NS, "a": DRAWING_NS}
    with ZipFile(path) as archive:
        slide_names = sorted(
            (
                name
                for name in archive.namelist()
                if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)
            ),
            key=lambda name: int(re.search(r"slide(\d+)", name).group(1)),  # type: ignore[union-attr]
        )
        slides: list[dict[str, list[tuple[int, str]]]] = []
        for slide_name in slide_names:
            root = ET.fromstring(archive.read(slide_name))
            shapes: dict[str, list[tuple[int, str]]] = {}
            for shape in root.findall(".//p:sp", ns):
                metadata = shape.find("p:nvSpPr/p:cNvPr", ns)
                shape_name = metadata.attrib.get("name", "") if metadata is not None else ""
                paragraphs: list[tuple[int, str]] = []
                for paragraph in shape.findall(".//a:p", ns):
                    text = "".join(
                        run.text or "" for run in paragraph.findall(".//a:t", ns)
                    ).strip()
                    if not text:
                        continue
                    properties = paragraph.find("a:pPr", ns)
                    level = int(properties.attrib.get("lvl", "0")) if properties is not None else 0
                    paragraphs.append((level, text))
                if paragraphs:
                    shapes[shape_name] = paragraphs
            slides.append(shapes)
        return slides


def criteria(content: list[tuple[int, str]]) -> dict[str, list[str]]:
    sections = {"Entrance": [], "Tools": [], "Exit": [], "Steps": []}
    current = ""
    for level, text in content:
        label = text.rstrip(": ")
        if label in sections and level <= 1:
            current = label
        elif current and level >= 2:
            sections[current].append(text)
    return sections


def node(
    identifier: str,
    kind: str,
    name: str,
    text: str,
    properties: dict[str, str],
    *,
    spaces: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": identifier,
        "kind": kind,
        "name": name,
        "text": text,
        "spaceIds": spaces or [],
        "properties": properties,
    }


def edge(
    identifier: str,
    source: str,
    target: str,
    relationship: str,
    relation_role: str,
    *,
    project_action: bool = False,
    properties: dict[str, str] | None = None,
) -> dict[str, Any]:
    edge_properties = {"osa:relation": relation_role}
    if properties:
        edge_properties.update(properties)
    return {
        "id": identifier,
        "source": source,
        "target": target,
        "relationKind": "project-task" if project_action else "related",
        "relationship": relationship,
        "properties": edge_properties,
    }


def create_package(presentation: Path, workbook: Path) -> dict[str, Any]:
    slides = slide_paragraphs(presentation)
    bom = workbook_rows(workbook, "BOM")
    supplies = workbook_rows(workbook, "Supplies")
    presentation_hash = sha256(presentation)
    workbook_hash = sha256(workbook)
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

    nodes.append(node("space", "space", "Shako Light Wrap", "", {}))
    nodes.append(node(
        "assembly",
        # An assembly is a composed part. OSA still accepts legacy assemblies
        # saved as projects, but new imports use the durable part kind.
        "part",
        "Shako Hat Assembly Instructions",
        "Assembly instructions imported for authoring in OSA.",
        {
            "osa:role": "assembly",
            "source:file": presentation.name,
            "source:location": "Slides 1–4",
        },
        spaces=["space"],
    ))
    nodes.extend([
        node(
            "source-pptx",
            "source-file",
            presentation.name,
            "Original assembly-instruction presentation.",
            {
                "osa:role": "source",
                "source:file": presentation.name,
                "source:sha256": presentation_hash,
            },
            spaces=["space"],
        ),
        node(
            "source-xlsx",
            "source-file",
            workbook.name,
            "Original BOM and project-expense workbook.",
            {
                "osa:role": "source",
                "source:file": workbook.name,
                "source:sha256": workbook_hash,
            },
            spaces=["space"],
        ),
    ])
    edges.extend([
        edge("assembly-source-pptx", "assembly", "source-pptx", "comes from", "assembly-source"),
        edge("assembly-source-xlsx", "assembly", "source-xlsx", "comes from", "assembly-source"),
    ])

    outline_shape = next(
        (paragraphs for name, paragraphs in slides[0].items() if "Content" in name),
        [],
    )
    outline: list[tuple[int, str]] = outline_shape
    detail_slide_for_outline_index = {0: 2, 2: 3, 3: 4}
    top_index = -1
    child_index = 0
    for level, operation_name in outline:
        if level == 0:
            top_index += 1
            child_index = 0
            order = str(top_index + 1)
            identifier = f"operation-{top_index + 1:02d}"
            source_slide = detail_slide_for_outline_index.get(top_index, 1)
            entrance: list[str] = []
            tools: list[str] = []
            exit_values: list[str] = []
            source_title = ""
            if source_slide > 1:
                source_title = next(
                    (
                        paragraphs[0][1]
                        for name, paragraphs in slides[source_slide - 1].items()
                        if "Title" in name and paragraphs
                    ),
                    "",
                )
                content = next(
                    (paragraphs for name, paragraphs in slides[source_slide - 1].items() if "Content" in name),
                    [],
                )
                parsed = criteria(content)
                entrance = parsed["Entrance"]
                tools = parsed["Tools"]
                exit_values = parsed["Exit"]
            properties = {
                "osa:role": "operation",
                "osa:order": order,
                "operation:entrance": "\n".join(entrance),
                "operation:exit": "\n".join(exit_values),
                "source:file": presentation.name,
                "source:location": f"Slide {source_slide}",
                "source:title": source_title,
            }
            visual = INSTRUCTION_VISUALS_BY_SLIDE.get(source_slide)
            source_visual_id = ""
            if visual:
                source_visual_id = f"visual-{identifier}-source-slide"
                # This is a compatibility *pointer*, not a duplicated image
                # value. The operation-source-visual edge below is the
                # authoritative graph relationship.
                properties["instruction:visual"] = source_visual_id
                properties["instruction:visualAlt"] = visual["alt"]
            nodes.append(node(identifier, "action", operation_name, "", properties, spaces=["space"]))
            edges.append(edge(
                f"assembly-{identifier}",
                "assembly",
                identifier,
                "contains operation",
                "assembly-operation",
                project_action=True,
            ))
            if visual:
                nodes.append(node(
                    source_visual_id,
                    "visual",
                    f"{operation_name} — Source Slide",
                    "Source slide visual imported from the assembly-instruction presentation.",
                    {
                        "osa:role": "visual",
                        # The visual owns its reusable image. Its sketch/text
                        # document remains ordinary node data, so a later
                        # editor can evolve the visual without touching any
                        # card placement that references it.
                        "asset:image": visual["url"],
                        "asset:imageAlt": visual["alt"],
                        # Existing AssemblyView versions resolve a visual-node
                        # pointer through these legacy field names. Keep this
                        # mirror on the Visual object—not on the operation—so
                        # current cards continue to render while the relation
                        # becomes the durable source of truth.
                        "instruction:visual": visual["url"],
                        "instruction:visualAlt": visual["alt"],
                        "source:file": presentation.name,
                        "source:location": f"Slide {source_slide}",
                        "source:title": source_title,
                    },
                    spaces=["space"],
                ))
                edges.append(edge(
                    f"{identifier}-source-visual",
                    identifier,
                    source_visual_id,
                    "uses source visual",
                    "operation-source-visual",
                ))
            for tool_name in tools:
                tool_key = re.sub(r"[^a-z0-9]+", "-", tool_name.lower()).strip("-")
                tool_id = f"tool-{tool_key}"
                if not any(existing["id"] == tool_id for existing in nodes):
                    nodes.append(node(
                        tool_id,
                        "tool",
                        tool_name,
                        "",
                        {
                            "osa:role": "tool",
                            "source:file": presentation.name,
                            "source:location": f"Slide {source_slide}, Tools",
                        },
                        spaces=["space"],
                    ))
                edges.append(edge(
                    f"{identifier}-{tool_id}",
                    identifier,
                    tool_id,
                    "uses tool",
                    "operation-tool",
                ))
        else:
            child_index += 1
            order = f"{top_index + 1}.{child_index}"
            identifier = f"operation-{top_index + 1:02d}-{child_index:02d}"
            nodes.append(node(
                identifier,
                "action",
                operation_name,
                "",
                {
                    "osa:role": "operation",
                    "osa:order": order,
                    "operation:entrance": "",
                    "operation:exit": "",
                    "source:file": presentation.name,
                    "source:location": "Slide 1, outline",
                },
                spaces=["space"],
            ))
            edges.append(edge(
                f"assembly-{identifier}",
                "assembly",
                identifier,
                "contains operation",
                "assembly-operation",
                project_action=True,
            ))

    bom_ids_by_name: dict[str, str] = {}
    for row_number in range(3, max(bom) + 1):
        row = bom.get(row_number, {})
        item_name = row.get("A", Cell()).value.strip()
        if not item_name:
            continue
        identifier = f"bom-{row_number}"
        description = row.get("B", Cell()).value
        status = description if description.strip() in {"HAVE", "???"} else ""
        source = row.get("E", Cell())
        properties = {
            "osa:role": "bom-item",
            "item:quantity": number_text(row.get("C", Cell()).value),
            "item:packagePrice": number_text(row.get("F", Cell()).value, money=True),
            "item:packageQuantity": number_text(row.get("G", Cell()).value),
            "item:purchasedQuantity": number_text(row.get("H", Cell()).value),
            "item:reportedCost": number_text(row.get("D", Cell()).value),
            "item:status": status,
            "money:currency": "USD",
            "source:text": source.value,
            "source:url": source.hyperlink,
            "source:file": workbook.name,
            "source:location": f"BOM!A{row_number}:I{row_number}",
        }
        nodes.append(node(identifier, "part", item_name, description, properties, spaces=["space"]))
        edges.append(edge(
            f"assembly-{identifier}",
            "assembly",
            identifier,
            "uses part",
            "assembly-item",
        ))
        bom_ids_by_name[item_name.casefold()] = identifier

    # The source slide explicitly establishes an Electronics/Connector Box as
    # the input and a drilled box as the output. Preserve the PowerPoint
    # wording above in operation:entrance/operation:exit, but add durable links
    # so the Assembly View, Cave, and later views do not need to repeat that
    # wording as unrelated text. `Connector Box Drilled` is deliberately a
    # placeholder work-state, not a second purchased BOM item.
    def required_bom_id(name: str) -> str:
        identifier = bom_ids_by_name.get(name.casefold())
        if not identifier:
            raise ValueError(f"The Shako BOM must contain {name!r} for its source mapping.")
        return identifier

    electronics_box_id = required_bom_id("Electronics Box")

    drilled_box_id = "part-connector-box-drilled"
    nodes.append(node(
        drilled_box_id,
        "part",
        "Connector Box Drilled",
        (
            "Placeholder work-state for the Electronics Box after the "
            "Connector Box Drill operation. This is not a separately "
            "purchased item."
        ),
        {
            "osa:role": "bom-item",
            "item:status": "placeholder",
            "source:text": "Connector Box Top – 1 Hole and Bottom – 2 Holes",
            "source:file": presentation.name,
            "source:location": "Slide 2, Exit",
            "source:inference": (
                "Created as the addressable output state of the source "
                "slide's Connector Box Drill operation. The source calls "
                "the incoming purchased component Electronics Box / "
                "Connector Box."
            ),
            "asset:image": OBJECT_VISUALS_BY_ID[drilled_box_id]["url"],
            "asset:imageAlt": OBJECT_VISUALS_BY_ID[drilled_box_id]["alt"],
        },
        spaces=["space"],
    ))
    edges.append(edge(
        f"assembly-{drilled_box_id}",
        "assembly",
        drilled_box_id,
        "tracks part",
        "assembly-item",
        properties={
            "source:inference": (
                "Added to the assembly's parts list as a derived work-state, "
                "not a separately purchased BOM item."
            ),
        },
    ))
    edges.extend([
        edge(
            f"operation-01-{electronics_box_id}-input",
            "operation-01",
            electronics_box_id,
            "uses as input",
            "operation-input",
            properties={
                "source:inference": (
                    "Inferred from Slide 2 Entrance: Connector Box as "
                    "Delivered, to the BOM's Electronics Box."
                ),
            },
        ),
        edge(
            f"operation-01-{drilled_box_id}-output",
            "operation-01",
            drilled_box_id,
            "produces as output",
            "operation-output",
            properties={
                "source:inference": (
                    "Inferred from Slide 2 Exit: Connector Box Top – 1 Hole "
                    "and Bottom – 2 Holes."
                ),
            },
        ),
        edge(
            f"operation-01-{drilled_box_id}-primary-output",
            "operation-01",
            drilled_box_id,
            "is the primary output",
            "operation-primary-output",
            properties={
                "source:inference": (
                    "Inferred from source Slide 2: the source slide is "
                    "specifically about drilling the Connector Box, so this "
                    "derived work-state is the operation card's primary "
                    "represented output."
                ),
            },
        ),
    ])

    # Slide 3 gives both of this operation's inputs and its exit condition.
    # `Boost` is the slide's shorthand for the BOM's DC-DC Converter. The
    # completed boost is a durable work-state rather than another purchased
    # component, just like the drilled Connector Box above.
    boost_converter_id = required_bom_id("DC-DC Converter")
    wires_id = required_bom_id("Wires")
    boost_with_v_out_wires_id = "part-boost-with-v-out-wires"
    nodes.append(node(
        boost_with_v_out_wires_id,
        "part",
        "Boost with V-out Wires",
        (
            "Placeholder work-state for the DC-DC Converter after the "
            "V-out wires have been attached. This is not a separately "
            "purchased item."
        ),
        {
            "osa:role": "bom-item",
            "item:status": "placeholder",
            "source:text": "Boost w/attached V-out Wires",
            "source:file": presentation.name,
            "source:location": "Slide 3, Exit",
            "source:inference": (
                "Created as the addressable output state of Slide 3. The "
                "slide calls the incoming BOM component a Boost and the exit "
                "a Boost with attached V-out Wires."
            ),
            "asset:image": OBJECT_VISUALS_BY_ID[boost_with_v_out_wires_id]["url"],
            "asset:imageAlt": OBJECT_VISUALS_BY_ID[boost_with_v_out_wires_id]["alt"],
        },
        spaces=["space"],
    ))
    edges.extend([
        edge(
            f"assembly-{boost_with_v_out_wires_id}",
            "assembly",
            boost_with_v_out_wires_id,
            "tracks part",
            "assembly-item",
            properties={
                "source:inference": (
                    "Added to the assembly's parts list as the derived work-state "
                    "named by Slide 3's Exit, not as a purchased BOM item."
                ),
            },
        ),
        edge(
            f"operation-03-{boost_converter_id}-input",
            "operation-03",
            boost_converter_id,
            "uses as input",
            "operation-input",
            properties={
                "source:inference": (
                    "Inferred from Slide 3 Entrance: Boost as Delivered, to the "
                    "BOM's DC-DC Converter."
                ),
            },
        ),
        edge(
            f"operation-03-{wires_id}-input",
            "operation-03",
            wires_id,
            "uses as input",
            "operation-input",
            properties={
                "source:inference": (
                    "Inferred from Slide 3 Entrance: Pre-stripped red x1 and "
                    "black x2 wires, to the BOM's Wires."
                ),
            },
        ),
        edge(
            f"operation-03-{boost_with_v_out_wires_id}-output",
            "operation-03",
            boost_with_v_out_wires_id,
            "produces as output",
            "operation-output",
            properties={
                "source:inference": (
                    "Inferred from Slide 3 Exit: Boost w/attached V-out Wires."
                ),
            },
        ),
        edge(
            f"operation-03-{boost_with_v_out_wires_id}-primary-output",
            "operation-03",
            boost_with_v_out_wires_id,
            "is the primary output",
            "operation-primary-output",
            properties={
                "source:inference": (
                    "Inferred from the Slide 3 title and Exit: this card is about "
                    "the Boost after its V-out wires are attached."
                ),
            },
        ),
    ])

    # Slide 4 lists a Battery Holder Top with Heatshrink leads as one incoming
    # unit. Preserve that source-level unit as an addressable nested assembly,
    # while linking its known purchased ingredients beneath it. This makes the
    # card's In list faithful to the slide without duplicating procurement
    # records or asserting that it was produced by an unrecorded operation.
    battery_holder_id = required_bom_id("Battery Holder")
    heat_shrink_id = required_bom_id("Heat Shrink")
    battery_holder_top_id = "assembly-battery-holder-top-with-heatshrink-leads"
    nodes.append(node(
        battery_holder_top_id,
        "part",
        "Battery Holder Top with Heatshrink Leads",
        (
            "Source-named prepared subassembly: the Battery Holder Top with "
            "Heatshrink leads. Its detailed preparation steps are not yet in "
            "the source instruction deck."
        ),
        {
            "osa:role": "assembly",
            "source:text": "Battery Holder Top w/ Heatshrink leads",
            "source:file": presentation.name,
            "source:location": "Slide 4, Entrance",
            "source:inference": (
                "Created as the source-named input subassembly. Its component "
                "links are inferred from the words Battery Holder and Heatshrink "
                "and their matching BOM items."
            ),
        },
        spaces=["space"],
    ))
    edges.extend([
        edge(
            f"assembly-{battery_holder_top_id}",
            "assembly",
            battery_holder_top_id,
            "tracks subassembly",
            "assembly-item",
            properties={
                "source:inference": (
                    "Added as the source-named prepared input from Slide 4's "
                    "Entrance list."
                ),
            },
        ),
        edge(
            f"{battery_holder_top_id}-{battery_holder_id}",
            battery_holder_top_id,
            battery_holder_id,
            "contains component",
            "assembly-item",
            properties={
                "source:inference": (
                    "Inferred from Slide 4 Entrance: Battery Holder Top w/ "
                    "Heatshrink leads, to the BOM's Battery Holder."
                ),
            },
        ),
        edge(
            f"{battery_holder_top_id}-{heat_shrink_id}",
            battery_holder_top_id,
            heat_shrink_id,
            "contains component",
            "assembly-item",
            properties={
                "source:inference": (
                    "Inferred from Slide 4 Entrance: Battery Holder Top w/ "
                    "Heatshrink leads, to the BOM's Heat Shrink."
                ),
            },
        ),
    ])

    # The Slide 4 title and full visual show the completed Power Section, so
    # model it as the card's represented nested assembly. Its Exit text instead
    # repeats the Boost work-state; preserve that text as-is on the operation
    # and make the disagreement explicit rather than silently rewriting it.
    mounts_zip_ties_id = required_bom_id("Mounts Zip Ties")
    zip_ties_id = required_bom_id("Zip Ties")
    power_section_id = "assembly-power-section"
    nodes.append(node(
        power_section_id,
        "part",
        "Power Section Assembly",
        (
            "Placeholder nested assembly represented by the Power Section "
            "instruction card and diagram."
        ),
        {
            "osa:role": "assembly",
            "source:text": "Power Section / Power Section Assembly",
            "source:file": presentation.name,
            "source:location": "Slide 1, outline; Slide 4, title and visual",
            "source:inference": (
                "Created as the card's addressable primary output because the "
                "outline names Power Section Assembly and Slide 4 depicts the "
                "assembled Power Section."
            ),
            "source:conflict": (
                "Slide 4 Exit says Boost w/attached V-out Wires. That original "
                "text remains in the operation:exit property for author review."
            ),
            "asset:image": OBJECT_VISUALS_BY_ID[power_section_id]["url"],
            "asset:imageAlt": OBJECT_VISUALS_BY_ID[power_section_id]["alt"],
        },
        spaces=["space"],
    ))
    edges.extend([
        edge(
            f"assembly-{power_section_id}",
            "assembly",
            power_section_id,
            "tracks subassembly",
            "assembly-item",
            properties={
                "source:inference": (
                    "Added as the nested Power Section Assembly named in the "
                    "source outline and visual."
                ),
            },
        ),
        edge(
            f"operation-04-{boost_with_v_out_wires_id}-input",
            "operation-04",
            boost_with_v_out_wires_id,
            "uses as input",
            "operation-input",
            properties={
                "source:inference": (
                    "Inferred from Slide 4 Entrance: Boost Attached V-out Wires, "
                    "to the derived Boost with V-out Wires work-state from Slide 3."
                ),
            },
        ),
        edge(
            f"operation-04-{battery_holder_top_id}-input",
            "operation-04",
            battery_holder_top_id,
            "uses as input",
            "operation-input",
            properties={
                "source:inference": (
                    "Inferred from Slide 4 Entrance: Battery Holder Top w/ "
                    "Heatshrink leads."
                ),
            },
        ),
        edge(
            f"operation-04-{drilled_box_id}-input",
            "operation-04",
            drilled_box_id,
            "uses as input",
            "operation-input",
            properties={
                "source:inference": (
                    "Inferred from Slide 4 Entrance: Electronics Box Top Drilled, "
                    "to the Connector Box Drilled work-state from Slide 2."
                ),
            },
        ),
        edge(
            f"operation-04-{mounts_zip_ties_id}-input",
            "operation-04",
            mounts_zip_ties_id,
            "uses as input",
            "operation-input",
            properties={
                "source:inference": (
                    "Inferred from Slide 4 Entrance: 3M Cable Relief Mounts x2, "
                    "to the BOM's Mounts Zip Ties. Brand and quantity remain in "
                    "the preserved source text for author review."
                ),
            },
        ),
        edge(
            f"operation-04-{zip_ties_id}-input",
            "operation-04",
            zip_ties_id,
            "uses as input",
            "operation-input",
            properties={
                "source:inference": (
                    "Inferred from Slide 4 Entrance: Zip ties x2, to the BOM's "
                    "Zip Ties."
                ),
            },
        ),
        edge(
            f"operation-04-{power_section_id}-output",
            "operation-04",
            power_section_id,
            "produces as output",
            "operation-output",
            properties={
                "source:inference": (
                    "Inferred from the source outline, Slide 4 title, and visual. "
                    "Slide 4's conflicting Exit wording is preserved separately "
                    "for author review."
                ),
            },
        ),
        edge(
            f"operation-04-{power_section_id}-primary-output",
            "operation-04",
            power_section_id,
            "is the primary output",
            "operation-primary-output",
            properties={
                "source:inference": (
                    "Inferred from the card's Power Section Assembly outline name "
                    "and the Slide 4 Power Section visual."
                ),
            },
        ),
        edge(
            f"{power_section_id}-{boost_with_v_out_wires_id}",
            power_section_id,
            boost_with_v_out_wires_id,
            "contains component",
            "assembly-item",
            properties={
                "source:inference": "Inferred from Slide 4's Entrance list.",
            },
        ),
        edge(
            f"{power_section_id}-{battery_holder_top_id}",
            power_section_id,
            battery_holder_top_id,
            "contains subassembly",
            "assembly-item",
            properties={
                "source:inference": "Inferred from Slide 4's Entrance list.",
            },
        ),
        edge(
            f"{power_section_id}-{drilled_box_id}",
            power_section_id,
            drilled_box_id,
            "contains component",
            "assembly-item",
            properties={
                "source:inference": "Inferred from Slide 4's Entrance list.",
            },
        ),
        edge(
            f"{power_section_id}-{mounts_zip_ties_id}",
            power_section_id,
            mounts_zip_ties_id,
            "contains component",
            "assembly-item",
            properties={
                "source:inference": "Inferred from Slide 4's Entrance list.",
            },
        ),
        edge(
            f"{power_section_id}-{zip_ties_id}",
            power_section_id,
            zip_ties_id,
            "contains component",
            "assembly-item",
            properties={
                "source:inference": "Inferred from Slide 4's Entrance list.",
            },
        ),
    ])

    expense_ids_by_name: dict[str, str] = {}
    for row_number in range(3, max(supplies) + 1):
        row = supplies.get(row_number, {})
        expense_name = row.get("A", Cell()).value.strip()
        if not expense_name:
            continue
        identifier = f"expense-{row_number}"
        source = row.get("F", Cell())
        properties = {
            "osa:role": "expense",
            "expense:quantity": number_text(row.get("C", Cell()).value),
            "expense:unitCost": number_text(row.get("D", Cell()).value, money=True),
            "expense:group": row.get("G", Cell()).value,
            "money:currency": "USD",
            "source:text": source.value,
            "source:url": source.hyperlink,
            "source:file": workbook.name,
            "source:location": f"Supplies!A{row_number}:G{row_number}",
        }
        nodes.append(node(
            identifier,
            "expense",
            expense_name,
            row.get("B", Cell()).value,
            properties,
            spaces=["space"],
        ))
        edges.append(edge(
            f"assembly-{identifier}",
            "assembly",
            identifier,
            "records expense",
            "assembly-expense",
        ))
        expense_ids_by_name[expense_name.casefold()] = identifier

    for tool_name in ("Helping Hands", "Zip Tie Gun"):
        tool_key = re.sub(r"[^a-z0-9]+", "-", tool_name.lower()).strip("-")
        expense_id = expense_ids_by_name.get(tool_name.casefold())
        if expense_id:
            edges.append(edge(
                f"tool-{tool_key}-{expense_id}",
                f"tool-{tool_key}",
                expense_id,
                "has purchase record",
                "tool-expense",
                properties={
                    "source:inference": (
                        "Inferred by matching the PowerPoint tool name to the "
                        "Supplies expense name; the source files do not explicitly "
                        "encode this relationship."
                    ),
                },
            ))

    return {
        "format": "osa-import",
        "version": 1,
        "id": "shako-light-wrap",
        "name": "Shako Light Wrap",
        "sources": [
            {
                "id": "source-pptx",
                "kind": "pptx",
                "fileName": presentation.name,
                "sha256": presentation_hash,
            },
            {
                "id": "source-xlsx",
                "kind": "xlsx",
                "fileName": workbook.name,
                "sha256": workbook_hash,
            },
        ],
        "nodes": nodes,
        "edges": edges,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("presentation", type=Path)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    package = create_package(arguments.presentation, arguments.workbook)
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n")
    print(
        f"Wrote {len(package['nodes'])} nodes and {len(package['edges'])} edges "
        f"to {arguments.output}"
    )


if __name__ == "__main__":
    main()
