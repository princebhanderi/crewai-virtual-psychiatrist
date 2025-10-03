import os
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

async def test_mongodb_connection():
    """Test MongoDB Atlas connection with different configurations"""
    
    MONGO_URI = os.getenv("MONGO_URI")
    DB_NAME = os.getenv("DB_NAME")
    
    if not MONGO_URI:
        print("❌ Error: MONGO_URI not found in .env file")
        return
    
    if not DB_NAME:
        print("❌ Error: DB_NAME not found in .env file")
        return
    
    print(f"📋 Testing connection to: {MONGO_URI[:30]}...")
    print(f"📋 Database name: {DB_NAME}")
    print("\n" + "="*60)
    
    # Test 1: Basic connection
    print("\n🔍 Test 1: Basic connection with SSL...")
    try:
        client = AsyncIOMotorClient(
            MONGO_URI,
            serverSelectionTimeoutMS=10000
        )
        await client.admin.command('ping')
        print("✅ Basic connection successful!")
        client.close()
    except Exception as e:
        print(f"❌ Basic connection failed: {e}")
    
    # Test 2: Connection with TLS
    print("\n🔍 Test 2: Connection with TLS enabled...")
    try:
        client = AsyncIOMotorClient(
            MONGO_URI,
            tls=True,
            serverSelectionTimeoutMS=10000
        )
        await client.admin.command('ping')
        print("✅ TLS connection successful!")
        client.close()
    except Exception as e:
        print(f"❌ TLS connection failed: {e}")
    
    # Test 3: Connection with TLS and invalid certificates allowed
    print("\n🔍 Test 3: Connection with TLS (allow invalid certificates)...")
    try:
        client = AsyncIOMotorClient(
            MONGO_URI,
            tls=True,
            tlsAllowInvalidCertificates=True,
            serverSelectionTimeoutMS=10000
        )
        await client.admin.command('ping')
        print("✅ TLS connection (with invalid certs) successful!")
        
        # Test database access
        print("\n🔍 Testing database access...")
        db = client[DB_NAME]
        collections = await db.list_collection_names()
        print(f"✅ Database accessible! Collections: {collections}")
        
        client.close()
    except Exception as e:
        print(f"❌ TLS connection (with invalid certs) failed: {e}")
    
    print("\n" + "="*60)
    print("\n💡 Recommendations:")
    print("1. Ensure your IP address is whitelisted in MongoDB Atlas")
    print("2. Check that your username/password are correct")
    print("3. Verify your internet connection is stable")
    print("4. Try running: pip install --upgrade pymongo motor certifi")

if __name__ == "__main__":
    asyncio.run(test_mongodb_connection())
