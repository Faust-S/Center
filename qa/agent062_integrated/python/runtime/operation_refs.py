from runtime import personal_agent as core

def oref(kind,ref_id,digest):
    obj={'schema_version':'0.11','ref_kind':kind,'ref_id':str(ref_id),'digest_sha256':str(digest),'digest_profile':'IWXA_CANONICAL_JSON_SHA256_V1'}
    core.validate('operation-ref.schema.json',obj)
    return obj
