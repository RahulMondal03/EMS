"""Read raw bytes from a serial (COM) port and save them to disk.

By default this opens COM3 at 9600 baud and appends every byte it receives to
a binary capture file. Status messages (connects, disconnects, errors) go to a
separate log file and to the console. If the device is unplugged or the port
drops, the reader waits and reconnects until you stop it with Ctrl+C.

Example:
    python serial_reader/com_reader.py --port COM3 --baud 115200 --timeout 1
"""

import argparse
import logging
import sys
import time

try:
    import serial
except ImportError:  # pragma: no cover - only hit when pyserial is missing
    sys.exit("pyserial is not installed. Run: pip install -r requirements.txt")

log = logging.getLogger("com_reader")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Capture raw bytes from a serial port (default COM3)."
    )
    parser.add_argument("--port", default="COM3",
                        help="Serial port name, e.g. COM3 or /dev/ttyUSB0 (default: COM3)")
    parser.add_argument("--baud", type=int, default=9600,
                        help="Baud rate (default: 9600)")
    parser.add_argument("--timeout", type=float, default=1.0,
                        help="Read timeout in seconds (default: 1.0)")
    parser.add_argument("--output", default="com_capture.bin",
                        help="File the raw bytes are appended to (default: com_capture.bin)")
    parser.add_argument("--log-file", default="com_reader.log",
                        help="File status messages are written to (default: com_reader.log)")
    parser.add_argument("--reconnect-delay", type=float, default=2.0,
                        help="Seconds to wait before reconnecting after a disconnect (default: 2.0)")
    parser.add_argument("--hex", action="store_true",
                        help="Also print each received chunk to the console as hex")
    return parser.parse_args(argv)


def setup_logging(log_file):
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    log.setLevel(logging.INFO)
    for handler in (logging.FileHandler(log_file, encoding="utf-8"),
                    logging.StreamHandler()):
        handler.setFormatter(fmt)
        log.addHandler(handler)


def open_port(port, baud, timeout):
    return serial.Serial(port=port, baudrate=baud, timeout=timeout)


def read_loop(ser, out, show_hex=False):
    """Append incoming bytes to ``out`` until the port raises an error."""
    while True:
        # Read whatever is waiting, or block for at least one byte up to timeout.
        chunk = ser.read(ser.in_waiting or 1)
        if not chunk:
            continue
        out.write(chunk)
        out.flush()
        if show_hex:
            print(chunk.hex(" "))


def run(args):
    with open(args.output, "ab") as out:
        while True:
            try:
                ser = open_port(args.port, args.baud, args.timeout)
            except serial.SerialException as exc:
                log.warning("Cannot open %s: %s. Retrying in %.1fs",
                            args.port, exc, args.reconnect_delay)
                time.sleep(args.reconnect_delay)
                continue

            log.info("Connected to %s at %d baud, writing to %s",
                     args.port, args.baud, args.output)
            try:
                with ser:
                    read_loop(ser, out, args.hex)
            except (serial.SerialException, OSError) as exc:
                log.warning("Lost connection to %s: %s. Reconnecting in %.1fs",
                            args.port, exc, args.reconnect_delay)
                time.sleep(args.reconnect_delay)


def main(argv=None):
    args = parse_args(argv)
    setup_logging(args.log_file)
    try:
        run(args)
    except KeyboardInterrupt:
        log.info("Stopped by user")
    return 0


if __name__ == "__main__":
    sys.exit(main())
