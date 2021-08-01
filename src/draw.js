const JOIN_MITRE = 0;
const JOIN_ROUND = 1;
const JOIN_BEVEL = 2;

const CAP_BUTT = 0;
const CAP_ROUND = 1;
const CAP_SQUARE = 2;
const CAP_TRIANGLE = 3;

const WINDING_NON_ZERO = 0;
const WINDING_EVEN_ODD = 1;

const TYPE_PATH = 2;
const TYPE_SPRITE = 5;
const TYPE_GROUP = 6;
const TYPE_OPTIONS = 11;

const TAG_END = 0;
const TAG_MOVE = 2;
const TAG_UNKNOWN = 4;
const TAG_CLOSE_SUB_PATH = 5;
const TAG_BEZIER = 6;
const TAG_DRAW = 8;

class DrawError extends Error {
    constructor(message, position, data) {
        super(message);
        this.name = 'DrawError';
        this.position = position;
        this.data = data;
    }
}

class DrawFile {

    constructor(buffer) {
        this.view = new DataView(buffer);
        this.length = buffer.byteLength;
        this.position = 0;
    }

    getLength() {
        return this.length;
    }

    getPosition() {
        return this.position;
    }

    setPosition(v) {
        this.position = v;
    }

    check(condition, message, data = {}) {
        if (!condition) {
            throw new DrawError(message, this.getPosition(), data);
        }
    }

    fail(message, data = {}) {
        this.check(false, message, data);
    }

    checkAlignment(message, data = {}) {
        this.check(this.getPosition() % 4 === 0, message, data);
    }

    checkPositionAndSize(n) {
        this.check(this.getPosition() >= 0, 'reading off the start of a file');
        this.check(this.getPosition() <= this.getLength() - n, 'reading off the end of the file');
    }

    readByte() {
        this.checkPositionAndSize(1);
        const b = this.view.getUint8(this.position);
        this.position = this.position + 1;
        return b;
    }

    readUint() {
        this.checkAlignment('misaligned uint');
        this.checkPositionAndSize(4);
        const v = this.view.getUint32(this.position, true);
        this.position = this.position + 4;
        return v;
    }

    readInt() {
        this.checkAlignment('misaligned int');
        this.checkPositionAndSize(4);
        const v = this.view.getInt32(this.position, true);
        this.position = this.position + 4;
        return v;
    }

    readStringFully(n) {
        this.checkAlignment('misaligned string');
        const chars = [];
        for (let i = 0, terminated = false; i < n; i = 1 + i) {
            const c = this.readByte();
            if (c === 0) {
                terminated = true;
            } else if (!terminated) {
                chars.push(c)
            }
        }
        return String.fromCharCode(...chars);
    }

    readPoint() {
        this.checkAlignment('misaligned point');
        const x = this.readInt();
        const y = this.readInt();
        return {x, y};
    }

    readBoundingBox() {
        this.checkAlignment('misaligned bounding box');
        const minX = this.readInt();
        const minY = this.readInt();
        const maxX = this.readInt();
        const maxY = this.readInt();
        return {minX, minY, maxX, maxY};
    }

    readPathElement() {
        const tag = this.readUint();
        if (tag === TAG_END) {
            return {tag};
        } else if (tag === TAG_MOVE) {
            const p0 = this.readPoint();
            return {tag, points: [p0]};
        } else if (tag === TAG_UNKNOWN) {
            // skip
        } else if (tag === TAG_CLOSE_SUB_PATH) {
            return {tag};
        } else if (tag === TAG_BEZIER) {
            const p0 = this.readPoint();
            const p1 = this.readPoint();
            const p2 = this.readPoint();
            return {tag, points: [p0, p1, p2]};
        } else if (tag === TAG_DRAW) {
            const p0 = this.readPoint();
            return {tag, points: [p0]};
        } else {
            this.fail('unsupported path tag', {tag: tag.toString(16)});
        }
    }

    readPath(end) {
        this.checkAlignment('misaligned path');
        const path = [];
        while (this.getPosition() < end) {
            path.push(this.readPathElement());
        }
        return path;
    }

    readDash() {
        const offset = this.readInt();
        const count = this.readUint();
        const array = []
        for (let i = 0; i < count; i++) {
            array.push(this.readInt());
        }
        return {offset, array};
    }

    readPathStyle() {
        const style = this.readUint();
        let dash = undefined;
        if ((style >> 7) & 0x1) {
            dash = this.readDash();
        }
        return {
            join: style & 0x3,
            capEnd: (style >> 2) & 0x3,
            capStart: (style >> 4) & 0x3,
            windingRule: (style >> 6) & 0x1,
            ...(dash && {dash}),
            triangleCapWidth: (style >> 16) & 0xFF,
            triangleCapLength: (style >> 24) & 0xFF
        };
    }

    readHeader() {
        this.checkAlignment('misaligned header');
        return {
            identifier: this.readStringFully(4),
            majorVersion: this.readUint(),
            minorVersion: this.readUint(),
            program: this.readStringFully(12),
            boundingBox: this.readBoundingBox()
        };
    }

    readPathObject(end) {
        this.checkAlignment('misaligned path object');
        return {
            boundingBox: this.readBoundingBox(),
            fillColour: this.readUint(),
            outlineColour: this.readUint(),
            outlineWidth: this.readUint(),
            pathStyle: this.readPathStyle(),
            path: this.readPath(end)
        };
    }

    readSpriteObject(end) {
        this.checkAlignment('misaligned sprite object');
        return {
            boundingBox: this.readBoundingBox(),
            start: this.getPosition(),
            end
        }
    }

    readGroupObject() {
        this.checkAlignment('misaligned group object');
        return {
            boundingBox: this.readBoundingBox(),
            name: this.readStringFully(12)
        };
    }

    readOptionsObject() {
        this.checkAlignment('misaligned options object');
        return {
            boundingBox: this.readBoundingBox(),
            paperSize: this.readUint(),
            paperLimits: this.readUint(),
            gridSpacing1: this.readUint(),
            gridSpacing2: this.readUint(),
            gridDivision: this.readUint(),
            gridType: this.readUint(),
            gridAutoAdjustment: this.readUint(),
            gridShown: this.readUint(),
            gridLocking: this.readUint(),
            gridUnits: this.readUint(),
            zoomMultiplier: this.readUint(),
            zoomDivider: this.readUint(),
            zoomLocking: this.readUint(),
            toolboxPresent: this.readUint(),
            entryMode: this.readUint(),
            undoBufferSizeBytes: this.readUint()
        }
    }

    readObjectForType(type, end) {
        this.checkAlignment('misaligned object body');
        switch (type) {
            case TYPE_PATH:
                return this.readPathObject(end);
            case TYPE_SPRITE:
                return this.readSpriteObject(end);
            case TYPE_GROUP:
                return {
                    size: 36,
                    ...this.readGroupObject()
                };
            case TYPE_OPTIONS:
                return this.readOptionsObject();
            default:
                return {};
        }
    }

    readObject() {
        this.checkAlignment('misaligned object');
        const objectPosition = this.getPosition();
        const type = this.readInt()
        const size = this.readInt();
        const end = objectPosition + size;
        return {
            type,
            size,
            ...this.readObjectForType(type, end)
        }
    }

    load() {
        const header = this.readHeader();
        const objects = [];
        while (this.getPosition() < this.getLength()) {
            const position = this.getPosition();
            const object = this.readObject();
            objects.push(object);
            const {size} = object;
            this.setPosition(position + size);
        }
        return {
            header,
            objects
        };
    }
}

module.exports = {
    JOIN_MITRE,
    JOIN_ROUND,
    JOIN_BEVEL,

    CAP_BUTT,
    CAP_ROUND,
    CAP_SQUARE,
    CAP_TRIANGLE,

    WINDING_NON_ZERO,
    WINDING_EVEN_ODD,

    TYPE_PATH,
    TYPE_SPRITE,
    TYPE_GROUP,
    TYPE_OPTIONS,

    TAG_END,
    TAG_MOVE,
    TAG_CLOSE_SUB_PATH,
    TAG_BEZIER,
    TAG_DRAW,

    Draw: {
        fromUint8Array: function (buffer) {
            return new DrawFile(buffer.buffer).load();
        }
    }
}
