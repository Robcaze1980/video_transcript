import json
import sys

import numpy as np
from faster_whisper import WhisperModel


def main():
    model_directory, language, *window = sys.argv[1:]
    audio = np.frombuffer(sys.stdin.buffer.read(), dtype="<i2").astype(np.float32) / 32768
    offset = 0
    if window:
        start, end = (round(float(value) * 16000) for value in window)
        audio = audio[start:end]
        offset = start / 16000
    model = WhisperModel(model_directory, device="cpu", compute_type="int8",
                         cpu_threads=4, local_files_only=True)
    segments, _ = model.transcribe(audio, language=language, beam_size=3,
                                   word_timestamps=True, condition_on_previous_text=False)
    words = [{"start": word.start + offset, "end": word.end + offset, "text": word.word}
             for segment in segments for word in segment.words or []
             if word.end > word.start]
    json.dump(words, sys.stdout)


if __name__ == "__main__":
    main()
