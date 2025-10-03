import os
import logging
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient
from typing import Optional
from dotenv import load_dotenv
from crewai.crews.crew_output import CrewOutput
from bson import ObjectId
from src.assignment.crew import Assignment  

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173","https://psychiatrist-frontend-tayx.onrender.com"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)

crew_instance = Assignment().crew()

MONGO_URI = os.getenv("MONGO_URI")
DB_NAME = os.getenv("DB_NAME")

# Configure MongoDB client with TLS settings for Windows compatibility
# Add connection string parameters to handle SSL/TLS issues
mongo_uri_with_params = MONGO_URI
if "?" not in mongo_uri_with_params:
    mongo_uri_with_params += "?"
else:
    mongo_uri_with_params += "&"
mongo_uri_with_params += "tlsAllowInvalidCertificates=true&tls=true"

# Initialize MongoDB client (connection will be lazy)
client = AsyncIOMotorClient(
    mongo_uri_with_params,
    serverSelectionTimeoutMS=10000,
    connectTimeoutMS=20000,
    connect=False,  # Don't connect immediately, connect on first operation
)
db = client[DB_NAME]
collection = db["users"]
chat_collection = db["chat_history"]

class User(BaseModel):
    username: str
    password: str

class UserInDB(User):
    id: str

class Message(BaseModel):
    text: str

async def get_chatbot_response(user_id: str, user_message: str) -> str:
    try:
        chat_history = await chat_collection.find_one({"user_id": user_id})
        previous_messages = ""

        if chat_history and "messages" in chat_history:
            previous_messages = "\n".join(
                [f"User: {msg['user']}\nBot: {msg['bot']}" for msg in chat_history["messages"][-10:]]
            )

        conversation_context = f"{previous_messages}\nUser: {user_message}\nBot:"
        
        inputs = {
            "context": conversation_context,
            "user_message": user_message,
            "student_issue": user_message,
        }
        
        response = crew_instance.kickoff(inputs=inputs)

        if isinstance(response, CrewOutput):
            return response.raw

        return str(response)
    except Exception as e:
        logging.error(f"Error in chatbot response: {e}")
        return "I'm sorry, I encountered an error."

@app.post("/register/", response_model=UserInDB)
async def register_user(user: User):
    existing_user = await collection.find_one({"username": user.username})
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already taken")

    result = await collection.insert_one({"username": user.username, "password": user.password})

    new_user = await collection.find_one({"_id": result.inserted_id})
    return UserInDB(id=str(new_user["_id"]), username=new_user["username"], password=new_user["password"])

@app.post("/login/")
async def login_user(user: User):
    existing_user = await collection.find_one({"username": user.username})

    if not existing_user or existing_user["password"] != user.password:
        raise HTTPException(status_code=400, detail="Invalid username or password")

    user_id = str(existing_user["_id"])
    
    response = JSONResponse(content={"message": "Login successful"})
    response.set_cookie(key="session_user_id", value=user_id, httponly=True, secure=True, samesite="Lax")

    return response

@app.post("/logout/")
async def logout_user():
    response = JSONResponse(content={"message": "Logout successful"})
    response.delete_cookie(key="session_user_id")
    return response

async def get_current_user(request: Request):
    user_id = request.cookies.get("session_user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="User not authenticated")
    return user_id

@app.get("/user/")
async def get_current_user_details(user_id: str = Depends(get_current_user)):
    user = await collection.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": str(user["_id"]), "username": user["username"]}


@app.post("/chat/")
async def chat_with_bot(message: Message, user_id: str = Depends(get_current_user)):
    try:
        bot_response = await get_chatbot_response(user_id, message.text)

        chat_history = await chat_collection.find_one({"user_id": user_id})

        if not chat_history:
            chat_history = {"user_id": user_id, "messages": []}

        message_entry = {"user": message.text, "bot": bot_response}
            
        chat_history["messages"].append(message_entry)

        await chat_collection.update_one(
            {"user_id": user_id},
            {"$set": {"messages": chat_history["messages"]}},
            upsert=True
        )

        return {"response": bot_response}
    except Exception as e:
        logging.error(f"Error during chat processing: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/chat/")
async def get_chat_history(user_id: str = Depends(get_current_user)):
    chat_history = await chat_collection.find_one({"user_id": user_id})

    if not chat_history:
        raise HTTPException(status_code=404, detail="Chat history not found")

    return {"user_id": user_id, "chat_history": chat_history["messages"]}
