import os
import sys

# Directories to create
dirs = [
    r"C:\Users\iopwisp\Downloads\TuskHub\Backend\discovery-service\src\main\java\iopwisp\discovery_service",
    r"C:\Users\iopwisp\Downloads\TuskHub\Backend\discovery-service\src\main\resources",
    r"C:\Users\iopwisp\Downloads\TuskHub\Backend\discovery-service\src\test\java\iopwisp\discovery_service",
    r"C:\Users\iopwisp\Downloads\TuskHub\Backend\scripts"
]

print("Creating directories...")
for dir_path in dirs:
    try:
        os.makedirs(dir_path, exist_ok=True)
        print(f"✓ CREATED: {dir_path}")
    except Exception as e:
        print(f"✗ FAILED: {dir_path} - {e}")

print("\nVerifying directories exist...")
all_exist = True
for dir_path in dirs:
    if os.path.isdir(dir_path):
        print(f"✓ EXISTS: {dir_path}")
    else:
        print(f"✗ MISSING: {dir_path}")
        all_exist = False

sys.exit(0 if all_exist else 1)
