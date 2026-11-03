# EMS

## COM port reader

`serial_reader/com_reader.py` captures raw bytes from a serial port (COM3 by
default) and appends them to a binary file. It keeps running if the device is
unplugged: it logs the disconnect, waits, and reconnects.

### Install

```
pip install -r requirements.txt
```

### Run

```
python serial_reader/com_reader.py
python serial_reader/com_reader.py --port COM3 --baud 115200 --timeout 0.5
python serial_reader/com_reader.py --port /dev/ttyUSB0 --hex
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--port` | `COM3` | Serial port name (`COMn` on Windows, `/dev/tty...` on Linux/macOS) |
| `--baud` | `9600` | Baud rate; must match the device |
| `--timeout` | `1.0` | Read timeout in seconds |
| `--output` | `com_capture.bin` | Raw bytes are appended here |
| `--log-file` | `com_reader.log` | Connect, disconnect and error messages |
| `--reconnect-delay` | `2.0` | Seconds to wait before reconnecting |
| `--hex` | off | Also print each received chunk as hex |

Stop it with Ctrl+C. To inspect the capture, use a hex viewer, for example
`xxd com_capture.bin | head`.
