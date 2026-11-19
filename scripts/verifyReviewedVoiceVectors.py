"""Independent, read-only check of fixed synthetic canon vectors; no network."""
import hashlib
import json
import re
from pathlib import Path


def encoded(value):
    # The fixed vectors contain integers and valid Unicode only. This is not a
    # general replacement for ECMAScript JSON serialization of arbitrary data.
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def units(text):
    return len(text.encode('utf-16-le')) // 2


def chunks(text):
    # Independent expression of the existing v1 splitter; vectors exercise
    # ASCII spaces and LF, not the full ECMAScript whitespace set.
    result, current = [], ''
    for sentence in re.split(r'(?<=[.!?])\s+', text.strip()):
        parts = [sentence] if units(sentence) <= 320 else re.split(r'\s+', sentence)
        for part in parts:
            assert units(part) <= 320
            if current and units(current) + units(part) + 1 > 320:
                result.append(current)
                current = ''
            current += (' ' if current else '') + part
    if current:
        result.append(current)
    return result


path = Path(__file__).resolve().parents[1] / 'server/commercial/reviewedVoiceCanonical.vectors.json'
document = json.loads(path.read_text(encoding='utf-8'))
assert document['version'] == 1 and len(document['vectors']) == 5
style = ('English narration in a clear, neutral standard voice. Read all the supplied text faithfully, '
         'including names, numbers and units. Preserve Spanish pronunciation of Spanish personal names. '
         'Do not add commentary.')
calls_checked = 0
for vector in document['vectors']:
    evidence, review, receipt = vector['evidence'], vector['evidence']['review'], vector['evidence']['receipt']
    account, input_id, job, revision = (evidence['accountId'], evidence['inputId'], evidence['textJobId'], evidence['revision'])
    review_id = sha(encoded(['review-revision-v1', account, input_id, job, revision]))
    assert evidence['reviewId'] == review_id == receipt['reviewId']
    assert evidence['receiptId'] == review['receiptId']
    assert review['createdAtMs'] == receipt['createdAtMs']
    payload = review['payload']
    assert encoded(json.loads(payload)) == payload
    assert sha(payload) == review['payloadSha256'] == receipt['payloadSha256'] == vector['payloadSha256']
    parsed = json.loads(payload)
    for index, cue in enumerate(parsed['cues']):
        assert cue['index'] == index
        assert cue['id'] == sha('lv016-cue-id-v1\0' + job + '\0' + str(index))
    voice_text = ''.join(cue['en'] + '\n' for cue in parsed['cues'])
    assert sha(voice_text) == review['voiceSha256'] == receipt['voiceSha256'] == vector['voiceTextSha256']
    fingerprint = sha(encoded(['review-save-v1', account, input_id, job, revision - 1,
                              [[cue['id'], cue['en']] for cue in parsed['cues']]]))
    assert fingerprint == review['fingerprint'] == receipt['fingerprint']
    parts = chunks(voice_text)
    assert len(parts) == vector['chunkCount'] == len(vector['calls'])
    voice = 'Kore' if vector['operation'] == 'narration:en:female' else 'Charon'
    assert voice == vector['voiceId'] and vector['model'] == 'gemini-3.8-flash-tts'
    for index, (part, call) in enumerate(zip(parts, vector['calls'])):
        body = encoded({'contents': [{'parts': [{'text': part, 'speech_metadata': {'style': style}}]}],
                        'generationConfig': {'responseModalities': ['AUDIO'], 'speechConfig': {'voiceConfig': {'voice': voice}}}})
        assert call['callKey'] == f'voice-chunk:{index:04d}'
        assert body == call['body'] and sha(body) == call['requestSha256']
        calls_checked += 1
print(json.dumps({'result': 'PASS', 'vectors': len(document['vectors']), 'calls': calls_checked,
                  'scope': 'synthetic UTF-8, ECMAScript-compatible subset and ASCII/LF whitespace'}))
